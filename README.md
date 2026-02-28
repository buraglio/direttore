# Direttore — Lab Infrastructure Management Platform

A vendor-agnostic network and compute lab automation platform combining **NetBox** inventory, **Nornir** network device configuration, and a modern **React + FastAPI** web interface for provisioning and reserving Proxmox VMs and LXC containers.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   React Frontend (Vite)                 │
│   Login · Dashboard · Resources · Provision · Calendar  │
└──────────────────┬────────────────────────────┬─────────┘
                   │ REST API (Bearer JWT)       │
┌──────────────────▼────────────────────────────▼─────────┐
│                  FastAPI Backend (api/)                  │
├──────────┬──────────┬────────────┬──────────────────────┤
│  Auth /  │ Proxmox  │ Reservatio │    NetBox Proxy       │
│  Users   │(proxmoxr)│ (SQLAlchmy)│    (httpx)            │
│  (JWT)   │          │            │                       │
└──────────┴──────────┴────────────┴──────────────────────┘
        │                                      │
  Proxmox VE API                         NetBox API
  (QEMU VMs + LXC)                  (Device inventory)

                    + Nornir pipeline (existing)
                    + Git-backed config storage (existing)
```

---

## Web UI Features

### Dashboard
Real-time cluster overview — one card per Proxmox node showing CPU, RAM, and disk utilization with auto-refresh every 30 seconds.

### Resources
Browse all VMs and LXC containers across nodes. Start, stop, and delete resources directly from the table.

### Provision Wizard
6-step wizard to provision a new VM or LXC container:
1. **Type** — choose VM (QEMU/KVM) or LXC Container, select target node
2. **Template** — select ISO or container template from node storage
3. **Resources** — set name, VMID, CPU cores, RAM, disk size
4. **Network & Storage** — configure storage pool and network interfaces:
   - **Storage**: select from available Proxmox storage pools (shows type and free space)
   - **NICs**: add up to 8 network interfaces per VM/LXC — each with:
     - Bridge selection (live list from the node's configured bridges)
     - Optional VLAN ID (1–4094; empty = untagged)
     - NIC model (VMs: VirtIO / E1000 / RTL8139)
     - Dual-stack IP: **IPv4 / CIDR** (or `dhcp`) + **IPv6 / Prefix** (or `auto` / `dhcp6`)
     - Default gateways (IPv4 / IPv6) and DNS servers
     - ☁ **NetBox IPAM Integration**: Connects to your NetBox instance to browse and select IP addresses, Prefix gateways, and VLANs directly in the wizard.
       - Automatically allocates the next available IP address from a selected Prefix.
       - Smart IPv6 handling (avoids network addresses like `::` and `.0`).
       - Auto-detects explicit default gateways from NetBox records, or gracefully assumes `.1` / `::1` as gateways when absent.
5. **Review** — confirm all settings including per-NIC summary table
6. **Progress** — live task progress bar polling the Proxmox UPID

### Reservation Calendar
FullCalendar week/month/day view. Click any time slot to reserve a resource window. Conflict detection prevents double-booking the same node.

### Authentication & Role-Based Access Control
JWT-based authentication with three built-in roles:

| Role | Dashboard & Resources | Provision & Reservations | Power Actions | Delete Resources | Manage Users |
|---|---|---|---|---|---|
| **admin** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **operator** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **viewer** | ✅ | ❌ | ❌ | ❌ | ❌ |

- The sidebar hides nav items the current user's role cannot access.
- Access tokens automatically refresh in the background — sessions are transparent.
- An initial **admin** account is created on first boot (configurable via `.env`).

---

## Screenshots

### Dashboard
![Dashboard — Proxmox node cards with resource usage](docs/screenshots/dashboard.png)

### Resource Browser
![Resources — VM table with status and action buttons](docs/screenshots/resources.png)

### Provision Wizard (Step 3 — Resources)
![Provision wizard showing resource configuration step](docs/screenshots/provision.png)

### Reservation Calendar
![Reservations calendar with scheduled lab sessions](docs/screenshots/reservations.png)

---

## Prerequisites

- Python 3.11+ (backend)
- Node.js 20+ (frontend)
- A Proxmox VE host, **or** use `PROXMOX_MOCK=true` for development without hardware
- NetBox instance (optional — only needed for the inventory proxy routes)

---

## Installation & Setup

### 1. Clone and branch

```bash
git clone <repo-url>
cd direttore
git checkout feature/react-fastapi-frontend
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your Proxmox host, credentials, and NetBox token
# Set PROXMOX_MOCK=true for development without real hardware
```

### 3. Backend setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-api.txt

# Start the API server on the IPv6 loopback
PROXMOX_MOCK=true uvicorn api.main:app --host ::1 --reload --port 8000
```

API docs available at **http://localhost:8000/docs**

On first startup, if no users exist in the database the backend **automatically creates an `admin` account** using the values from `.env`:
```
INITIAL_ADMIN_USER=admin
INITIAL_ADMIN_PASSWORD=changeme
```
> [!CAUTION]
> Change the default admin password immediately after first login. See [Authentication & User Management](#authentication--user-management) below.

### 4. Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Frontend available at **http://localhost:5173** — you will be redirected to `/login` automatically.

---

## Environment Variables

### Proxmox / NetBox / Core

| Variable | Default | Description |
|---|---|---|
| `PROXMOX_HOST` | `192.168.1.100` | Proxmox VE hostname or IP |
| `PROXMOX_USER` | `root@pam` | Proxmox API user |
| `PROXMOX_PASSWORD` | — | Proxmox API password |
| `PROXMOX_VERIFY_SSL` | `false` | Verify TLS certificate |
| `PROXMOX_MOCK` | `false` | Use mock data (no real Proxmox needed) |
| `NETBOX_URL` | `http://localhost:8000` | NetBox base URL |
| `NETBOX_TOKEN` | — | NetBox API token |
| `DATABASE_URL` | `sqlite+aiosqlite:///./direttore.db` | SQLAlchemy async DB URL |
| `API_CORS_ORIGINS` | `http://localhost:5173,...` | Comma-separated allowed CORS origins |

### Auth / JWT

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET_KEY` | `CHANGE_ME_...` | HS256 signing secret — **must** be changed in production |
| `JWT_ALGORITHM` | `HS256` | JWT signing algorithm |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | `60` | Access token lifetime (minutes) |
| `JWT_REFRESH_TOKEN_EXPIRE_DAYS` | `7` | Refresh token lifetime (days) |
| `INITIAL_ADMIN_USER` | `admin` | Username for the auto-created first-boot admin |
| `INITIAL_ADMIN_PASSWORD` | `changeme` | Password for the auto-created first-boot admin |

> [!IMPORTANT]
> Generate a secure `JWT_SECRET_KEY` before going to production:
> ```bash
> python -c "import secrets; print(secrets.token_hex(32))"
> ```

---

## API Reference

### Proxmox Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/proxmox/nodes` | List nodes with CPU/RAM/disk stats |
| `GET` | `/api/proxmox/nodes/{node}/networks` | List bridge interfaces on a node |
| `GET` | `/api/proxmox/nodes/{node}/storage` | List storage pools that support VM/CT disks |
| `GET` | `/api/proxmox/nodes/{node}/vms` | List QEMU VMs |
| `POST` | `/api/proxmox/nodes/{node}/vms` | Create a VM (supports multi-NIC, VLAN, storage selection) |
| `POST` | `/api/proxmox/nodes/{node}/vms/{vmid}/{action}` | start / stop / reboot / shutdown / delete |
| `GET` | `/api/proxmox/nodes/{node}/lxc` | List LXC containers |
| `POST` | `/api/proxmox/nodes/{node}/lxc` | Create a container (supports multi-NIC, VLAN, storage selection) |
| `POST` | `/api/proxmox/nodes/{node}/lxc/{vmid}/{action}` | start / stop / reboot / shutdown / delete |
| `GET` | `/api/proxmox/nodes/{node}/templates` | List available ISOs and templates |
| `GET` | `/api/proxmox/tasks/{node}/{upid}` | Poll task status by UPID |

#### VM creation request body (`POST /api/proxmox/nodes/{node}/vms`)

```json
{
  "vmid": 1042,
  "name": "my-vm",
  "cores": 2,
  "memory": 2048,
  "disk": "32G",
  "storage": "local-lvm",
  "iso": "local:iso/ubuntu-22.04.4-live-server-amd64.iso",
  "nics": [
    { "bridge": "vmbr0", "model": "virtio", "vlan": null },
    { "bridge": "vmbr1", "model": "e1000", "vlan": 100, "ip": "10.0.0.5/24", "gw": "10.0.0.1", "ip6": "2001:db8::5/64", "dns": "1.1.1.1 8.8.8.8" }
  ]
}
```

#### LXC creation request body (`POST /api/proxmox/nodes/{node}/lxc`)

```json
{
  "vmid": 3001,
  "hostname": "my-container",
  "cores": 1,
  "memory": 512,
  "storage": "local-lvm",
  "disk_size": 8,
  "template": "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.gz",
  "nics": [
    { "name": "eth0", "bridge": "vmbr0", "ip": "dhcp", "ip6": "auto", "vlan": null },
    { "name": "eth1", "bridge": "vmbr1", "ip": "10.10.100.5/24", "gw": "10.10.100.1", "ip6": "2001:db8::100:5/64", "gw6": "2001:db8::100:1", "dns": "1.1.1.1 2606:4700:4700::1111", "vlan": 200 }
  ],
  "password": "changeme",
  "unprivileged": true,
  "start_after_create": true
}
```

### Reservation Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/reservations/` | List reservations (filterable by `?start=&end=`) |
| `POST` | `/api/reservations/` | Create reservation (conflict check included) |
| `GET` | `/api/reservations/{id}` | Get a single reservation |
| `PATCH` | `/api/reservations/{id}` | Update a reservation |
| `DELETE` | `/api/reservations/{id}` | Cancel a reservation |
| `GET` | `/api/reservations/export/ical` | iCAL feed for calendar apps |

### Inventory Endpoints (NetBox proxy)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/inventory/netbox-status` | Quick reachability check |
| `GET` | `/api/inventory/devices` | Proxy NetBox device list |
| `GET` | `/api/inventory/ip-addresses` | IP addresses with dual-stack and DNS info |
| `GET` | `/api/inventory/prefixes` | IP prefixes with gateway and DNS hints |
| `GET` | `/api/inventory/vlans` | VLANs list |
| `POST` | `/api/inventory/prefixes/{id}/allocate` | Allocate the next available IP from a prefix |

### Auth Endpoints

> All endpoints except `/api/auth/token` and `/api/auth/refresh` require a valid `Authorization: Bearer <token>` header.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/token` | — | Exchange username + password for access + refresh tokens |
| `POST` | `/api/auth/refresh` | — | Exchange a refresh token for a new token pair |
| `GET` | `/api/auth/me` | Any | Return current user profile + permissions |

### User Management Endpoints (admin only)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/users/` | List all users |
| `POST` | `/api/users/` | Create a new user |
| `PATCH` | `/api/users/{id}` | Update role, password, or active status |
| `DELETE` | `/api/users/{id}` | Delete a user |

---

## nginx Reverse Proxy

Example configs live in [`docs/nginx/`](docs/nginx/):

| File | Purpose |
|---|---|
| [`direttore.conf`](docs/nginx/direttore.conf) | Main server block (HTTP + HTTPS variants) |
| [`websocket_map.conf`](docs/nginx/websocket_map.conf) | `map` block required for WebSocket/HMR support — goes in `http {}` context |

### URL routing

| Path prefix | Upstream |
|---|---|
| `/api/*` | FastAPI backend — `127.0.0.1:8000` |
| `/docs`, `/redoc`, `/openapi.json` | FastAPI Swagger/ReDoc (from backend) |
| `/` (everything else) | React frontend — `127.0.0.1:5173` |

Vite's HMR WebSocket is served on the same port as the dev server and is handled transparently via the `$connection_upgrade` map — no separate path needed.

> [!IMPORTANT]
> **Vite host check** — Vite's dev server rejects any request whose `Host` header isn't `localhost`/`127.0.0.1`. When nginx proxies from a real hostname (e.g. `netserv.example.com`), Vite returns an *"Invalid Host header"* error. The `vite.config.js` in this repo already sets `allowedHosts: 'all'` and `host: '0.0.0.0'` to fix this. If you see a blank page or that error, make sure the Vite dev server was **restarted** after the config change.

### Install (bare-metal)

```bash
# 1. Install the map snippet (http context — required for WebSocket support)
sudo cp docs/nginx/websocket_map.conf /etc/nginx/conf.d/

# 2. Install the site config
sudo cp docs/nginx/direttore.conf /etc/nginx/sites-available/direttore
sudo ln -s /etc/nginx/sites-available/direttore /etc/nginx/sites-enabled/

# 3. Edit server_name + certificate paths, then validate and reload
sudo nginx -t && sudo systemctl reload nginx
```

> **No TLS yet?** `direttore.conf` includes a commented-out plain HTTP server block at the bottom — use that for internal networks or staging.

> **Docker Compose:** replace `127.0.0.1:8000` / `127.0.0.1:5173` with `api:8000` / `frontend:80` and add `resolver 127.0.0.11 valid=10s;` inside the server block.

---

## Authentication & User Management

### First Login

After the backend starts for the first time, log in at `/login` with the credentials set in your `.env`:

```
INITIAL_ADMIN_USER=admin
INITIAL_ADMIN_PASSWORD=changeme
```

The backend logs a warning:
```
⚠  Created initial admin user 'admin'. Change the password immediately.
```

### Setting / Resetting a Password

**Via the REST API (recommended for production):**

```bash
# 1. Obtain a token
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/token \
  -d 'username=admin&password=changeme&grant_type=password' \
  -H 'Content-Type: application/x-www-form-urlencoded' | jq -r .access_token)

# 2. Find the target user ID
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/users/ | jq .

# 3. Set a new password (replace 1 with the user's ID)
curl -X PATCH http://localhost:8000/api/users/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"password": "my-new-secure-password"}'
```

**Via the interactive Swagger UI:**

1. Open **http://localhost:8000/docs**
2. Click **Authorize** → enter `admin` / `changeme`
3. Navigate to `PATCH /api/users/{id}` → try it out → provide `{"password": "newpassword"}`

**Emergency reset (direct DB access — no token needed):**

```bash
source .venv/bin/activate
python - <<'EOF'
import asyncio
from sqlalchemy import select
from api.db import AsyncSessionLocal
from api.models import User
from api.auth import hash_password

async def reset():
    async with AsyncSessionLocal() as s:
        user = (await s.execute(select(User).where(User.username == "admin"))).scalar_one()
        user.hashed_password = hash_password("new-secure-password")
        await s.commit()
        print(f"Password reset for user: {user.username}")

asyncio.run(reset())
EOF
```

### Managing Users

```bash
# Create a new operator-level user
curl -X POST http://localhost:8000/api/users/ \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"username": "alice", "password": "secure1234", "role": "operator"}'

# Demote a user to viewer
curl -X PATCH http://localhost:8000/api/users/2 \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"role": "viewer"}'

# Deactivate (soft-ban) a user without deleting them
curl -X PATCH http://localhost:8000/api/users/3 \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"is_active": false}'
```

### Role Reference

| Role | Permissions |
|---|---|
| `admin` | Full access — provision, delete, manage users, all read |
| `operator` | Provision VMs/LXC, manage reservations, power actions, all read |
| `viewer` | Read-only — dashboard + resources only |

---

## Systemd Services (Production)

For bare-metal production deployments, Direttore includes `systemd` service files to keep the API and Vite server running in the background.

```bash
# 1. Copy the unit files into systemd
sudo cp systemd/direttore-api.service /etc/systemd/system/
sudo cp systemd/direttore-frontend.service /etc/systemd/system/

# 2. Reload daemon, enable, and start
sudo systemctl daemon-reload
sudo systemctl enable --now direttore-api
sudo systemctl enable --now direttore-frontend

# 3. Check status and view logs
sudo systemctl status direttore-api
journalctl -u direttore-api -f
```

---

## Docker Compose (Local Dev)

```bash
cp .env.example .env   # set PROXMOX_MOCK=true
docker compose up
```

- API: **http://localhost:8000**
- Frontend: **http://localhost:5173**

---

## Project Structure

```
direttore/
├── api/                      # FastAPI backend
│   ├── main.py               # App entrypoint, CORS, lifespan, first-boot seed
│   ├── config.py             # Pydantic-settings from .env (incl. JWT config)
│   ├── auth.py               # JWT creation/verification, bcrypt password hashing
│   ├── deps.py               # get_current_user, require_roles(), require_permission()
│   ├── db.py                 # Async SQLAlchemy engine + get_session dependency
│   ├── models.py             # Reservation, ResourcePool, User, Role ORM models
│   ├── proxmox/
│   │   ├── client.py         # proxmoxer wrapper + mock data
│   │   ├── vms.py            # QEMU VM CRUD
│   │   ├── containers.py     # LXC container CRUD
│   │   ├── templates.py      # ISO/template listing
│   │   ├── network.py        # Bridge interface listing
│   │   └── storage.py        # Storage pool listing
│   └── routes/
│       ├── auth.py           # /api/auth/* (token, refresh, me)
│       ├── users.py          # /api/users/* (admin-only CRUD)
│       ├── proxmox.py        # /api/proxmox/* routes
│       ├── reservations.py   # /api/reservations/* routes
│       └── inventory.py      # /api/inventory/* routes (incl. prefix allocate)
├── frontend/                 # React + Vite SPA
│   ├── src/
│   │   ├── api/              # Axios client + typed API functions
│   │   ├── context/
│   │   │   └── AuthContext.jsx   # JWT storage, auto-refresh, login/logout
│   │   ├── components/
│   │   │   ├── Layout.jsx        # Sidebar with user badge + logout
│   │   │   └── ProtectedRoute.jsx# Auth + permission guard for routes
│   │   └── pages/
│   │       ├── Login.jsx         # Login form
│   │       ├── Dashboard.jsx     # Node cards + resource bars
│   │       ├── Resources.jsx     # VM/CT table with actions
│   │       ├── Provision.jsx     # 6-step provisioning wizard
│   │       └── Reservations.jsx  # FullCalendar + booking modal
│   └── Dockerfile.frontend
├── systemd/                  # systemd unit files
│   ├── direttore-api.service     # FastAPI/Uvicorn service
│   └── direttore-frontend.service# Vite dev server service
├── templates/                # Jinja2 network config templates
│   ├── junos/, arista/, panos/, nokia-sros/, mikrotik/
│   └── html/                 # Legacy Flask template (superseded)
├── nornir-examples/          # Nornir task examples
├── inventory.py              # Nornir + NetBox inventory plugin
├── deploy.py                 # Git-backed config deployment
├── requirements-api.txt      # Backend Python dependencies
├── Dockerfile.api            # Backend Docker image
├── docker-compose.yml        # Full-stack local dev
└── .env.example              # Environment variable template
```

---

## Connecting a Real Proxmox Host

1. Set `PROXMOX_MOCK=false` (or remove the flag) in `.env`
2. Fill in `PROXMOX_HOST`, `PROXMOX_USER`, `PROXMOX_PASSWORD`
3. If using a self-signed certificate, set `PROXMOX_VERIFY_SSL=false`
4. Ensure the Proxmox user has `VM.Allocate`, `VM.PowerMgmt`, `Datastore.Allocate` privileges

```bash
# Proxmox — create a dedicated API user (recommended over root)
pveum role add DirettoreRole -privs "VM.Allocate VM.PowerMgmt VM.Console Datastore.AllocateSpace Pool.Allocate"
pveum user add direttore@pve --password <password>
pveum aclmod / -user direttore@pve -role DirettoreRole
```

---

## Populating NetBox Inventory via SNMP

The `snmp_to_netbox.sh` bash script walks a live network device via SNMP and pushes it into the NetBox model (interfaces, VRFs, VLANs, IPv4, IPv6, Serial Number).

```bash
# Set your NetBox URL and token in .env or your environment
# SNMP_COMMUNITY defaults to "public" but can be overridden

# Single device (IPv4, literal IPv6, or DNS hostname)
./snmp_to_netbox.sh -s "New York" -r "Router" -t "ASR1000" gateway.local "Core Router 1"
./snmp_to_netbox.sh fd68:1e02:dc1a:ffff::1 "gw.buragl.io"

# Bulk import from CSV
./snmp_to_netbox.sh -f devices.csv
```

---

## Physical Network Automation (NetBox + Nornir + Unimus)

In addition to virtual infrastructure, Direttore manages physical networking hardware (Juniper, Cisco, Aruba, MikroTik, FS, IP Infusion, Palo Alto) using a closed-loop automation architecture:

1. **NetBox**: The "Source of Truth" detailing intended state (VLANs, IPs, devices).
2. **Nornir**: The orchestration engine that fetches NetBox data, renders Jinja2 templates via NAPALM/Netmiko, and pushes config.
3. **Unimus**: The auditor that automatically syncs from NetBox, backs up the operational state, and detects configuration drift.

For the detailed, step-by-step implementation plan (including directory structures, Junos examples, and Netmiko platform mapping), please read the **[Network Automation Implementation Plan](docs/network_automation_plan.md)**.

```bash
source .venv/bin/activate
# Example: Deploy provisioned VLANs to all Active Juniper switches
python nornir_automation/generate_and_push.py
```

---

## Roadmap

| Feature | Status | Effort |
|---|---|---|
| JWT RBAC Auth (admin / operator / viewer) | ✅ Done | — |
| NetBox IPAM auto-allocation (IPv4 + IPv6) | ✅ Done | — |
| Systemd service units | ✅ Done | — |
| User management UI (in-app admin panel) | Planned | 6 hrs |
| Real-time VM console (xterm.js + WebSocket) | Planned | 15 hrs |
| Snapshot management UI | Planned | 5 hrs |
| Prometheus metrics endpoint | Planned | 8 hrs |
| Two-way iCAL sync (CalDAV) | Planned | 8 hrs |
| YANG config validation | Planned | 5 hrs |
| Keycloak / OIDC SSO migration path | Planned | 8 hrs |

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-change`
3. Commit your changes: `git commit -m 'Add my change'`
4. Push and open a pull request

> **Note**: Set `PROXMOX_MOCK=true` during development so no Proxmox hardware is required.
