# Direttore - a framework for managing IT test lab infrastructure
## Network Test Lab Automation (NetBox + Nornir)


A vendor-agnostic network test lab automation platform with Git-backed configuration management, iCAL scheduling, and multi-vendor support (Juniper, Mikrotik, Nokia, Arista, Palo Alto).

## Direttore Overview
- **Static physical topology** (no cable/port changes)
- **Multi-vendor support** via Nornir plugins
- **Git-backed configuration storage** (full audit trail)
- **Web interface** for scheduling (iCAL feed)
- **CLI access** for direct automation

## Prerequisites

### Hardware/Software
- Ubuntu 22.04 LTS server (8GB RAM, 4 vCPU, 50GB disk)
- Physical/virtual lab devices with:
  - SSH access (key-based authentication)
  - API access enabled (NETCONF for Juniper/Nokia, XML API for PANW)
- [GitLab Community Edition](https://about.gitlab.com/install/) (self-hosted or cloud)
**Self hosted Gitlab is suggested for security considerations, this should work with any Git repository**

### Required Accounts
- NetBox admin account (created during setup)
- GitLab project maintainer access

## Installation

### Phase 1: Foundation Setup (10 hours)
#### 1. Deploy NetBox
```bash
# Install dependencies
sudo apt update && sudo apt install -y postgresql libpq-dev redis-server python3-venv git

# Clone and configure
git clone -b v3.7 https://github.com/netbox-community/netbox.git
cd netbox

# Generate secure secret key
SECRET_KEY=$(pwgen -s 50 1)
sed -i "s/SECRET_KEY = ''/SECRET_KEY = '$SECRET_KEY'/" netbox/netbox/configuration.py

# Initialize and start
./upgrade.sh
sudo systemctl start netbox netbox-rq
```
> **Verify**: Access ```http://[::1]:8000``` → Login with ```admin/admin```

#### 2. Configure NetBox Inventory
1. Create site: *Organization → Sites → Add*  
   - Name: ```Lab-Test```
2. Add devices (*Devices → Add Device*):  
   | Field          | Value for Juniper | Value for PANW       |
   |----------------|-------------------|----------------------|
   | Platform       | ```juniper_junos```   | ```paloalto_panos```     |
   | Serial         | ```JUNIPER-SERIAL```  | ```PANW-SERIAL```        |
   | Custom Fields  | ```netconf_port: 830``` | ```api_key: YOUR_API_KEY``` |
3. Map interfaces:  
   - For each device, add interfaces → Connect cables (e.g., ```xe-0/0/0``` → ```sw1-eth1```)

#### 3. Setup GitLab Repository
```bash
# Create project via GitLab UI:
# 1. New Project → Create blank project
# 2. Name: `network-configs`
# 3. Set as Private
# 4. Protect main branch: Settings → Repository → Protected Branches

# Generate deploy key
ssh-keygen -t ed25519 -f ~/.ssh/netbox_gitlab -N ""
cat ~/.ssh/netbox_gitlab.pub
```
> **Paste** public key in *Project → Settings → Repository → Deploy Keys* (enable **Write access**)

### Phase 2: Automation Pipeline
#### 1. Install Nornir Environment
```bash
python3 -m venv nornir_env
source nornir_env/bin/activate
pip install nornir "nornir[paramiko]" nornir-scrapli nornir-jinja2 nornir-utils gitpython
```

#### 2. Configure NetBox Inventory Plugin

verify `invendory.py`

`chmod +x inventory.py`

#### 3. Create Configuration Templates
Directory structure:
```text
templates/
├── junos/
│   └── bgp.j2        # {% for peer in bgp_peers %}set protocols bgp group ...{% endfor %}
├── panos/
│   └── nat.j2        # <entry name="{{ rule_name }}"><to><member>...</member></to></entry>
└── nokia/
    └── isis.j2       # configure router isis interface "{{ interface }}"
```

#### 4. Implement Git-Backed Deployment
Create ```deploy.py```:

verify `deploy.py`

`chmod +x deploy.py`

### Phase 3: Scheduling & Web UI (optional, still alpha)
#### 1. Setup iCAL Scheduler
```bash
pip install flask ics gunicorn
```

Create ```scheduler.py```:

verify `scheduler.py`

`chmod +x scheduler.py`

#### 2. Configure Web Interface

verify ```templates/html/index.html```:

#### 3. Start Scheduler Service
```bash
# Create systemd service
sudo tee /etc/systemd/system/scheduler.service <<EOF
[Unit]
Description=Network Scheduler
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/opt/network-automation
ExecStart=/opt/network-automation/nornir_env/bin/gunicorn -w 4 -b 0.0.0.0:5000 scheduler:app
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable scheduler && sudo systemctl start scheduler
```

## Validate Direttore

Verify all requirements are met:

| Requirement                | Validation Command/Step                                  | Expected Result                     |
|----------------------------|----------------------------------------------------------|-------------------------------------|
| **Physical topology**      | Check NetBox device interfaces                           | All cables connected correctly      |
| **Git config storage**     | ```cd /opt/network-configs && git log```                     | Commits after config deployments    |
| **Multi-vendor push**      | ```python deploy.py --hosts fw1```                           | PANW config applied successfully    |
| **iCAL scheduling**        | Open ```http://<server>/schedule.ics``` in Apple Calendar    | Events appear in calendar           |
| **CLI access**             | ```source nornir_env/bin/activate && nr-inventory --list```  | All lab devices listed              |

## 🚀 Usage Examples

### CLI Operations
```bash
# Activate environment
source nornir_env/bin/activate

# List all devices
nr-inventory --list

# Deploy BGP config to Juniper devices
python deploy.py --groups juniper

# Schedule daily BGP test
echo "0 2 * * * cd /opt/network-automation && python deploy.py --groups bgp_routers" | crontab -
```

### Web Interface 
1. Access ```http://<server-ip>```
2. Download iCAL feed for calendar integration
3. View scheduled jobs in UI

## 🌱 Post-MVP Extensions
| Feature                | Effort | Implementation Path                          |
|------------------------|--------|----------------------------------------------|
| Two-way iCAL sync      | 8 hrs  | Add ```caldav``` library integration             |
| Config validation      | 5 hrs  | Integrate ```yangify``` for Juniper/Nokia        |
| RBAC                   | 10 hrs | Implement Auth0 SSO with NetBox              |
| Real-time monitoring   | 12 hrs | Add Prometheus metrics endpoint              |

## 🤝 Contributing
Contributions are welcome! Please follow these steps:
1. Fork the repository
2. Create your feature branch (```git checkout -b feature/direttore```)
3. Commit your changes (```git commit -m 'Add some direttore'```)
4. Push to the branch (```git push origin feature/direttore```)
5. Open a Pull Request


---

> **Note**: This MVP assumes **static physical topology** - all cable connections remain fixed. Device additions/removals are handled through NetBox inventory updates only.  
> **Critical Path**: NetBox inventory setup → Nornir task templates → Git commit workflow

