# Direttore — Lab Infrastructure Management Platform

A vendor-agnostic network and compute lab automation platform combining **NetBox** inventory, **Nornir** network device configuration, and a modern **React + FastAPI** web interface for provisioning and reserving Proxmox VMs and LXC containers.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   React Frontend (Vite)                 │
│   Dashboard · Resources · Provision Wizard · Calendar   │
└──────────────────┬────────────────────────────┬─────────┘
                   │ REST API                   │
┌──────────────────▼────────────────────────────▼─────────┐
│                  FastAPI Backend (api/)                  │
├─────────────┬────────────────┬──────────────────────────┤
│  Proxmox    │  Reservations  │      NetBox Proxy        │
│  (proxmoxer)│  (SQLAlchemy)  │      (httpx)             │
└─────────────┴────────────────┴──────────────────────────┘
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
5-step wizard to provision a new VM or LXC container:
1. **Type** — choose VM (QEMU/KVM) or LXC Container, select target node
2. **Template** — select ISO or container template from node storage
3. **Resources** — set name, VMID, CPU, RAM, disk
4. **Review** — confirm before submit
5. **Progress** — live task progress bar polling the Proxmox UPID

### Reservation Calendar
FullCalendar week/month/day view. Click any time slot to reserve a resource window. Conflict detection prevents double-booking the same node.

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

# Start the API server
PROXMOX_MOCK=true uvicorn api.main:app --reload --port 8000
```

API docs available at **http://localhost:8000/docs**

### 4. Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Frontend available at **http://localhost:5173**

---

## Environment Variables

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

---

## API Reference

### Proxmox Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/proxmox/nodes` | List nodes with CPU/RAM/disk stats |
| `GET` | `/api/proxmox/nodes/{node}/vms` | List QEMU VMs |
| `POST` | `/api/proxmox/nodes/{node}/vms` | Create a VM |
| `POST` | `/api/proxmox/nodes/{node}/vms/{vmid}/{action}` | start / stop / reboot / shutdown / delete |
| `GET` | `/api/proxmox/nodes/{node}/lxc` | List LXC containers |
| `POST` | `/api/proxmox/nodes/{node}/lxc` | Create a container |
| `POST` | `/api/proxmox/nodes/{node}/lxc/{vmid}/{action}` | start / stop / reboot / shutdown / delete |
| `GET` | `/api/proxmox/nodes/{node}/templates` | List available ISOs and templates |
| `GET` | `/api/proxmox/tasks/{node}/{upid}` | Poll task status by UPID |

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
| `GET` | `/api/inventory/devices` | Proxy NetBox device list |
| `GET` | `/api/inventory/prefixes` | Proxy NetBox IP prefix list |

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
│   ├── main.py               # App entrypoint, CORS, lifespan
│   ├── config.py             # Pydantic-settings from .env
│   ├── db.py                 # Async SQLAlchemy engine
│   ├── models.py             # Reservation, ResourcePool ORM models
│   ├── proxmox/
│   │   ├── client.py         # proxmoxer wrapper + mock data
│   │   ├── vms.py            # QEMU VM CRUD
│   │   ├── containers.py     # LXC container CRUD
│   │   └── templates.py      # ISO/template listing
│   └── routes/
│       ├── proxmox.py        # /api/proxmox/* routes
│       ├── reservations.py   # /api/reservations/* routes
│       └── inventory.py      # /api/inventory/* routes
├── frontend/                 # React + Vite SPA
│   ├── src/
│   │   ├── api/              # Axios client + typed API functions
│   │   ├── components/
│   │   │   └── Layout.jsx    # Sidebar navigation
│   │   └── pages/
│   │       ├── Dashboard.jsx     # Node cards + resource bars
│   │       ├── Resources.jsx     # VM/CT table with actions
│   │       ├── Provision.jsx     # 5-step provisioning wizard
│   │       └── Reservations.jsx  # FullCalendar + booking modal
│   └── Dockerfile.frontend
├── templates/                # Jinja2 network config templates
│   ├── junos/, arista/, panos/, nokia-sros/, mikrotik/
│   └── html/                 # Legacy Flask template (superseded)
├── nornir-examples/          # Nornir task examples
├── inventory.py              # Nornir + NetBox inventory plugin
├── deploy.py                 # Git-backed config deployment
├── scheduler.py              # Legacy iCAL scheduler (superseded by API)
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

## Existing Nornir Workflow

The original network automation pipeline is unchanged and can be used alongside the new web UI:

```bash
source .venv/bin/activate

# List all devices from NetBox
nr-inventory --list

# Deploy BGP config to Juniper devices
python deploy.py --groups juniper
```

---

## Roadmap

| Feature | Effort |
|---|---|
| RBAC / Auth (Auth0 or local) | 10 hrs |
| Real-time VM console (xterm.js + WebSocket) | 15 hrs |
| Snapshot management UI | 5 hrs |
| Prometheus metrics endpoint | 8 hrs |
| Two-way iCAL sync (CalDAV) | 8 hrs |
| YANG config validation | 5 hrs |

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-change`
3. Commit your changes: `git commit -m 'Add my change'`
4. Push and open a pull request

> **Note**: Set `PROXMOX_MOCK=true` during development so no Proxmox hardware is required.
