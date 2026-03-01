#!/usr/bin/env bash
# Initialize a Proxmox Docker container for local development
# Sets the root password, updates appliances, downloads LXC templates, and stubs ISOs.

CONTAINER=${1:-pve-01}

echo "Initializing Proxmox node inside container: $CONTAINER"

echo "1. Setting root password to 'root'..."
docker exec "$CONTAINER" bash -c 'echo -e "root\nroot" | passwd root'

echo "2. Updating pveam (LXC appliance templates)..."
docker exec "$CONTAINER" pveam update

echo "3. Downloading Ubuntu 22.04 LXC template..."
docker exec "$CONTAINER" pveam download local ubuntu-22.04-standard_22.04-1_amd64.tar.zst

echo "4. Downloading Debian 12 LXC template..."
docker exec "$CONTAINER" pveam download local debian-12-standard_12.12-1_amd64.tar.zst

echo "5. Stubbing out mock ISO files for VM creation..."
# Proxmox requires the ISOs to exist locally to satisfy the qmcreate checks
docker exec "$CONTAINER" mkdir -p /var/lib/vz/template/iso/
docker exec "$CONTAINER" dd if=/dev/zero of=/var/lib/vz/template/iso/Rocky-9.4-x86_64-minimal.iso bs=1M count=1 2>/dev/null
docker exec "$CONTAINER" dd if=/dev/zero of=/var/lib/vz/template/iso/ubuntu-22.04.4-live-server-amd64.iso bs=1M count=1 2>/dev/null

echo "Initialization of $CONTAINER complete!"
