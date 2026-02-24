# Network Automation Implementation Plan: NetBox + Nornir + Unimus

This document outlines the step-by-step implementation plan for achieving closed-loop network automation, treating NetBox as the Source of Truth (SoT), Nornir for orchestration, and Unimus for operational state backup and drift detection. 

We will begin with **Juniper (Junos)** as the primary hardware source, establishing the patterns that will later scale to Cisco, Aruba, MikroTik, FS, IP Infusion, and Palo Alto.

---

## Phase 1: NetBox Data Modeling (The Source of Truth)

Before any code is written, NetBox must be configured to accurately model the Juniper hardware so Nornir knows exactly how to connect to it.

### Step 1.1: Standardize the Platform Slug
Nornir relies on the NetBox `platform slug` to determine which connection driver (e.g., netmiko, napalm, ncclient) to use.
1. In NetBox, navigate to **Devices > Platforms**.
2. Create a new Platform:
   - **Name:** Juniper Junos
   - **Slug:** `juniper_junos` *(CRITICAL: This exact slug tells Netmiko/NAPALM which driver to use).*
   - **Manufacturer:** Juniper
   - **RPC/API Type:** NETCONF (or SSH for CLI).

### Step 1.2: Populate Initial Inventory
1. Add your Juniper switches/routers to NetBox.
2. Assign the `juniper_junos` platform to each device.
3. Ensure the **Primary IPv4 Address** is set (this is the IP Nornir will use to connect).
4. Set the **Status** to `Active` (Nornir's dynamic inventory plugin filters on this by default).

### Step 1.3: Define Config Context / Custom Fields
1. If your Juniper devices share common variables (e.g., syslog servers, NTP, standard BGP ASNs), define these in NetBox **Config Contexts** assigned to the `juniper_junos` platform or specific sites. These variables will be pulled directly into Nornir's Jinja2 templates.

---

## Phase 2: Orchestration Base Setup (Nornir)

We will build the Python framework and directory structure required to fetch data from NetBox and execute tasks concurrently.

### Step 2.1: Python Environment & Dependencies
Create a virtual environment and install the required libraries:
```bash
python3 -m venv venv
source venv/bin/activate
pip install nornir nornir_netmiko nornir_napalm nornir_jinja2 nornir_utils pynetbox
# Install the third-party NetBox inventory plugin:
pip install nornir-netbox
```

### Step 2.2: Directory Structure
Inside the `direttore` repository, create the automation scaffolding:
```text
direttore/nornir_automation/
├── config.yaml               # Main Nornir configuration
├── inventory/                # Local overrides (rarely used with API inventory)
├── templates/                # Jinja2 templates for configuration
│   └── juniper_junos/        # Vendor-specific syntax directories
│       ├── system_base.j2
│       ├── vlans.j2
│       └── interfaces.j2
└── generate_and_push.py      # The primary Python execution script
```

### Step 2.3: Configure Nornir for NetBox (`config.yaml`)
Create the configuration file mapping Nornir to the NetBox API:
```yaml
---
inventory:
  plugin: nornir_netbox.plugins.inventory.netbox.NBInventory
  options:
    nb_url: "https://netbox.yourdomain.com"
    nb_token: "YOUR_NETBOX_TOKEN"  # Best practice: inject via ENV var
    ssl_verify: true
    filter_parameters:
      status: "active"
      platform: "juniper_junos"  # Start by targeting only Juniper
```

---

## Phase 3: Configuration Templating (Jinja2)

Juniper configuration can be pushed using `set` commands or hierarchical braced configuration. We will use hierarchical format because it is easier to read and diff.

### Step 3.1: Create Juniper Base Template
Create `templates/juniper_junos/system_base.j2`. Reference variables provided by Nornir (which fetched them from NetBox):

```jinja2
system {
    host-name {{ host.name }};
    time-zone America/Chicago;
    services {
        ssh {
            root-login deny;
            protocol-version v2;
        }
        netconf {
            ssh;
        }
    }
}
```

### Step 3.2: Create VLAN Template
Create `templates/juniper_junos/vlans.j2`.

```jinja2
vlans {
{% for vlan in host.data.vlans %}
    {{ vlan.name }} {
        vlan-id {{ vlan.vid }};
    }
{% endfor %}
}
```
*(Note: `host.data.vlans` will be populated in our Python script using `pynetbox`)*.

---

## Phase 4: Execution Script (`generate_and_push.py`)

This script ties it all together: extracting data, rendering the Juniper syntax, and applying it.

### Step 4.1: Building the Script
We will use **NAPALM** for Juniper. NAPALM natively understands Junos, supports configuration locking, and uses atomic `commit` capabilities, allowing safe configuration rollbacks on failure.

```python
import os
from nornir import InitNornir
from nornir_napalm.plugins.tasks import napalm_configure
from nornir_jinja2.plugins.tasks import template_file
from nornir_utils.plugins.functions import print_result

os.environ['NB_TOKEN'] = 'your_token'

# Initialize Nornir (connects to NetBox, loads inventory)
nr = InitNornir(config_file="config.yaml")

def deploy_juniper_base(task):
    # 1. Render the Jinja2 template using the host's inventory data
    template_path = f"templates/{task.host.platform}/system_base.j2"
    r = task.run(
        task=template_file,
        template=template_path,
        path=""
    )
    rendered_config = r.result

    # 2. Push the config using NAPALM
    # NAPALM natively understands Juniper's commit/rollback architecture
    task.run(
        task=napalm_configure,
        configuration=rendered_config,
        replace=False,  # Use 'merge' operation (Junos 'load merge')
        dry_run=False   # Set True to quickly check diffs without commiting
    )

# Execute the task concurrently across all targeted Junipers
result = nr.run(task=deploy_juniper_base)
print_result(result)
```

### Step 4.2: First Execution Run
1. Run the script with `dry_run=True` to observe the diff that NAPALM generates without altering production.
2. Review the diff.
3. Switch to `dry_run=False` to execute the structural atomic commit.

---

## Phase 5: Unimus Integration (Backup & Audit)

With NetBox as the SoT and Nornir prosecuting changes, Unimus acts as the auditor.

### Step 5.1: Configure NetBox Integration in Unimus
1. Log into Unimus.
2. Navigate to **Zones > Default View** (or relevant zone) > **Network Information System Importer**.
3. Point to your NetBox URL and provide a read-only token.
4. Set filtering rules (e.g., import all devices where Platform = `juniper_junos`).

### Step 5.2: Set Up Credentials and Discovery
1. In Unimus, go to **Credentials**. Ensure your Juniper SSH service account (the same one Nornir uses) is bound.
2. Unimus will automatically pull the Juniper IP addresses from NetBox, verify login access, and perform a full `show configuration` pull.

### Step 5.3: Drift Detection
1. In Unimus, configure Notifications (Email or Webhook) for **Configuration Changes**.
2. If an engineer manually logs into a Juniper ex4300 via CLI and alters an interface, Unimus will flag the drift on the next sync and send a diff alert.
3. To remediate, simply run your Nornir `deploy.py` script again. Nornir will read the intended state from NetBox, see the discrepancy via NAPALM's diff mechanism, and push the atomic fix.

---

## Next Steps for Expansion
Once Juniper is successfully managed via this workflow, adding a new vendor (e.g., Cisco IOS) is incredibly simple:
1. Add `cisco_ios` to NetBox Platforms.
2. Create `templates/cisco_ios/system_base.j2` using Cisco CLI syntax.
3. Update the `config.yaml` filter to include `cisco_ios`. Nornir will automatically choose the new folder based on the host's platform slug without rewriting the Python engine.
