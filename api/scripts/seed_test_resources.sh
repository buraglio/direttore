#!/usr/bin/env bash
# Seeds the local API with 4 test Proxmox resources (2 VMs, 2 LXCs)
# Requires the API container to be running and the Proxmox node to be initialized.

API_HOST=${API_HOST:-http://localhost:8000}
NODE=${1:-pve-01}

echo "Seeding test resources onto node $NODE via API at $API_HOST..."

echo "Creating VM 100 (test-router-vm)..."
curl -s -X POST -H "Content-Type: application/json" -d '{
  "vmid": 100,
  "name": "test-router-vm",
  "cores": 2,
  "memory": 2048,
  "disk": "32G",
  "storage": "local",
  "iso": "local:iso/Rocky-9.4-x86_64-minimal.iso",
  "kvm": false,
  "nics": [{"bridge": "vmbr0", "model": "virtio"}],
  "ostype": "l26",
  "start_after_create": true
}' "$API_HOST/api/proxmox/nodes/$NODE/vms"
echo ""

echo "Creating LXC 101 (test-router-lxc)..."
curl -s -X POST -H "Content-Type: application/json" -d '{
  "vmid": 101,
  "hostname": "test-router-lxc",
  "cores": 1,
  "memory": 1024,
  "swap": 512,
  "storage": "local",
  "disk_size": 8,
  "template": "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst",
  "nics": [{"name": "eth0", "bridge": "vmbr0", "ip": "dhcp"}],
  "password": "changeme",
  "unprivileged": true,
  "start_after_create": true
}' "$API_HOST/api/proxmox/nodes/$NODE/lxc"
echo ""

echo "Creating VM 102 (edge-router-vm)..."
curl -s -X POST -H "Content-Type: application/json" -d '{
  "vmid": 102,
  "name": "edge-router-vm",
  "cores": 4,
  "memory": 4096,
  "disk": "64G",
  "storage": "local",
  "iso": "local:iso/ubuntu-22.04.4-live-server-amd64.iso",
  "kvm": false,
  "nics": [{"bridge": "vmbr0", "model": "virtio"}, {"bridge": "vmbr1", "model": "virtio", "vlan": 10}],
  "ostype": "l26",
  "start_after_create": true
}' "$API_HOST/api/proxmox/nodes/$NODE/vms"
echo ""

echo "Creating LXC 103 (dns-cache-lxc)..."
curl -s -X POST -H "Content-Type: application/json" -d '{
  "vmid": 103,
  "hostname": "dns-cache-lxc",
  "cores": 2,
  "memory": 2048,
  "swap": 1024,
  "storage": "local",
  "disk_size": 16,
  "template": "local:vztmpl/debian-12-standard_12.12-1_amd64.tar.zst",
  "nics": [{"name": "eth0", "bridge": "vmbr0", "ip": "10.0.0.53/24", "gw": "10.0.0.1", "dns": "1.1.1.1 8.8.8.8"}],
  "password": "changeme123",
  "unprivileged": true,
  "start_after_create": true
}' "$API_HOST/api/proxmox/nodes/$NODE/lxc"
echo ""

echo "Done dispatching requests!"
