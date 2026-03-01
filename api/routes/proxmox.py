"""FastAPI router — Proxmox nodes, VMs, containers, networks, storage, task polling."""

from typing import Any, Literal
from fastapi import APIRouter, HTTPException

from api.services.proxmox import client as px_client
from api.services.proxmox import vms as px_vms
from api.services.proxmox import containers as px_ct
from api.services.proxmox import templates as px_tmpl
from api.services.proxmox import network as px_net
from api.services.proxmox import storage as px_stor
from api.schemas.proxmox import (
    NICConfig, CreateVMRequest, LXCNICConfig, CreateLXCRequest
)
from api.config import settings

router = APIRouter(prefix="/api/proxmox", tags=["proxmox"])

# In-memory track of instances that we are pretending are running
# because nested virtualization fails in the Docker mock environment
MOCK_RUNNING_INSTANCES: set[str] = set()


def _proxmox_error(e: Exception) -> str:
    """Extract a readable error message from a proxmoxer or generic exception."""
    # proxmoxer wraps HTTP errors — the response body is usually in str(e)
    msg = str(e)
    # Try to pull Proxmox's JSON "errors" or "message" field out if present
    import re
    m = re.search(r'"errors":\s*(\{[^}]+\})', msg)
    if m:
        return f"Proxmox error: {m.group(1)}"
    return msg


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------

@router.get("/nodes")
def get_nodes() -> list[dict[str, Any]]:
    """List all Proxmox nodes with resource summary."""
    try:
        return px_client.get_nodes()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ---------------------------------------------------------------------------
# Networks
# ---------------------------------------------------------------------------

@router.get("/nodes/{node}/networks")
def get_networks(node: str) -> list[dict[str, Any]]:
    """List bridge-type network interfaces available on a node."""
    try:
        return px_net.list_networks(node)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

@router.get("/nodes/{node}/storage")
def get_storage(node: str) -> list[dict[str, Any]]:
    """List storage pools on a node that support VM images or CT rootfs."""
    try:
        return px_stor.list_storage(node)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ---------------------------------------------------------------------------
# VMs
# ---------------------------------------------------------------------------

@router.get("/nodes/{node}/vms")
def get_vms(node: str) -> list[dict[str, Any]]:
    """List all QEMU VMs on a node."""
    vms = px_vms.list_vms(node)
    for vm in vms:
        if f"{node}_vm_{vm['vmid']}" in MOCK_RUNNING_INSTANCES:
            vm["status"] = "running"
    return vms


@router.get("/nodes/{node}/vms/{vmid}")
def get_vm_details(node: str, vmid: int) -> dict[str, Any]:
    """Get detailed configuration and status for a specific VM."""
    try:
        details = px_vms.get_vm_details(node, vmid)
        # Mock intercept status injection
        if f"{node}_vm_{vmid}" in MOCK_RUNNING_INSTANCES:
            details["status"]["status"] = "running"
        return details
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


<<<<<<< HEAD
=======
class NICConfig(BaseModel):
    """Network interface configuration for a QEMU VM."""
    bridge: str = "vmbr0"
    model: str = "virtio"           # virtio | e1000 | rtl8139
    vlan: Optional[int] = Field(None, ge=1, le=4094)  # VLAN tag (None = untagged)
    # IP configuration (used with cloud-init / ipconfig{n})
    ip: Optional[str] = None        # "dhcp" | "x.x.x.x/prefix"
    gw: Optional[str] = None        # IPv4 default gateway
    ip6: Optional[str] = None       # "auto" | "dhcp6" | "x::/prefix"
    gw6: Optional[str] = None       # IPv6 default gateway
    dns: Optional[str] = None       # space-separated nameservers

    def to_proxmox_net_string(self) -> str:
        """Return the net{n} parameter value for the Proxmox API."""
        s = f"{self.model},bridge={self.bridge}"
        if self.vlan is not None:
            s += f",tag={self.vlan}"
        return s

    def to_proxmox_ipconfig_string(self) -> Optional[str]:
        """
        Return the ipconfig{n} value for cloud-init VMs, or None.
        """
        parts: list[str] = []
        if self.ip is not None and "/" in self.ip:
            parts.append(f"ip={self.ip}")
            if self.gw:
                parts.append(f"gw={self.gw}")
        elif self.ip in ("dhcp", "auto"):
            parts.append(f"ip={self.ip}")

        if self.ip6 is not None and "/" in self.ip6:
            parts.append(f"ip6={self.ip6}")
            if self.gw6:
                parts.append(f"gw6={self.gw6}")
        elif self.ip6 in ("dhcp", "dhcp6", "auto"):
            # Proxmox uses "dhcp" or "auto" for IPv6. "dhcp6" is often a typo. We'll send "dhcp" if they passed "dhcp6".
            val = "dhcp" if self.ip6 == "dhcp6" else self.ip6
            parts.append(f"ip6={val}")

        return ",".join(parts) if parts else None

    # Backward-compat alias
    def to_proxmox_string(self) -> str:
        return self.to_proxmox_net_string()


class CreateVMRequest(BaseModel):
    vmid: int
    name: str
    cores: int = 2
    memory: int = 2048              # MB
    disk: str = "32G"
    storage: str = "local-lvm"     # storage pool for the primary disk
    iso: str | None = None          # e.g. "local:iso/ubuntu-22.04.4-live-server-amd64.iso"
    nics: List[NICConfig] = Field(default_factory=lambda: [NICConfig()])
    ostype: str = "l26"
    start_after_create: bool = False


>>>>>>> 6d7c0d87b61f060ea53d17cc0dafdb46f6368e58
@router.post("/nodes/{node}/vms", status_code=202)
def create_vm(node: str, req: CreateVMRequest) -> dict[str, Any]:
    """Create a new QEMU VM. Returns task UPID."""
    params: dict[str, Any] = {
        "vmid": req.vmid,
        "name": req.name,
        "cores": req.cores,
        "memory": req.memory,
        "ostype": req.ostype,
        "kvm": 1 if req.kvm else 0,
    }
    for idx, nic in enumerate(req.nics):
        params[f"net{idx}"] = nic.to_proxmox_net_string()
        ipconf = nic.to_proxmox_ipconfig_string()
        if ipconf:
            params[f"ipconfig{idx}"] = ipconf

    # Cloud-init User/Auth Configuration
    if req.username:
        params["ciuser"] = req.username
    if req.password:
        params["cipassword"] = req.password
    if req.ssh_key:
        params["sshkeys"] = req.ssh_key

    if req.iso:
        params["cdrom"] = req.iso
        disk_val = req.disk.rstrip("Gg")
        params["scsi0"] = f"{req.storage}:{disk_val}"
        params["ide2"] = f"{req.storage}:cloudinit"

    try:
        upid = px_vms.create_vm(node, params)
        return {"upid": upid, "node": node, "vmid": req.vmid}
    except Exception as e:
        raise HTTPException(status_code=502, detail=_proxmox_error(e))


@router.post("/nodes/{node}/vms/{vmid}/{action}", status_code=202)
def vm_action(
    node: str,
    vmid: int,
    action: Literal["start", "stop", "reboot", "shutdown", "delete"],
) -> dict[str, Any]:
    """Start, stop, reboot, shutdown, or delete a VM."""
    # MOCK INTERCEPT: The dev environment running in Docker cannot handle nested KVM virtualization
    if settings.proxmox_mock and node == "pve-01" and action in ("start", "stop"):
        if action == "start":
            MOCK_RUNNING_INSTANCES.add(f"{node}_vm_{vmid}")
        else:
            MOCK_RUNNING_INSTANCES.discard(f"{node}_vm_{vmid}")
        mock_upid = f"UPID:{node}:00000000:00000000:00000000:mock{action}:{vmid}:root@pam:"
        return {"upid": mock_upid, "node": node, "vmid": vmid, "action": action}

    try:
        upid = px_vms.action_vm(node, vmid, action)
        return {"upid": upid, "node": node, "vmid": vmid, "action": action}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ---------------------------------------------------------------------------
# LXC Containers
# ---------------------------------------------------------------------------

@router.get("/nodes/{node}/lxc")
def get_containers(node: str) -> list[dict[str, Any]]:
    """List all LXC containers on a node."""
    cts = px_ct.list_containers(node)
    for ct in cts:
        if f"{node}_lxc_{ct['vmid']}" in MOCK_RUNNING_INSTANCES:
            ct["status"] = "running"
    return cts


@router.get("/nodes/{node}/lxc/{vmid}")
def get_container_details(node: str, vmid: int) -> dict[str, Any]:
    """Get detailed configuration and status for a specific LXC container."""
    try:
        details = px_ct.get_container_details(node, vmid)
        # Mock intercept status injection
        if f"{node}_lxc_{vmid}" in MOCK_RUNNING_INSTANCES:
            details["status"]["status"] = "running"
        return details
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


<<<<<<< HEAD
=======
class LXCNICConfig(BaseModel):
    """Network interface configuration for an LXC container."""
    name: str = "eth0"              # interface name inside container
    bridge: str = "vmbr0"
    ip: str = "dhcp"                # "dhcp" | "x.x.x.x/prefix"
    gw: Optional[str] = None        # IPv4 default gateway
    ip6: Optional[str] = None       # "auto" | "dhcp6" | "x::/prefix"
    gw6: Optional[str] = None       # IPv6 default gateway
    dns: Optional[str] = None       # space-separated nameservers
    vlan: Optional[int] = Field(None, ge=1, le=4094)

    def to_proxmox_string(self, iface_index: int = 0) -> str:
        """Build the Proxmox net{n} string for this LXC NIC."""
        # Use unique interface names: eth0, eth1, … based on the NIC position
        iface_name = self.name if iface_index == 0 else f"eth{iface_index}"
        s = f"name={iface_name},bridge={self.bridge},ip={self.ip}"
        
        # Don't append gw if ip is auto or dhcp
        if self.gw and self.ip not in ("dhcp", "auto"):
            s += f",gw={self.gw}"

        if self.ip6:
            val = "dhcp" if self.ip6 == "dhcp6" else self.ip6
            s += f",ip6={val}"
            # Don't append gw6 if ip6 is auto or dhcp
            if self.gw6 and self.ip6 not in ("dhcp", "dhcp6", "auto"):
                s += f",gw6={self.gw6}"
                
        if self.vlan is not None:
            s += f",tag={self.vlan}"
        return s


class CreateLXCRequest(BaseModel):
    vmid: int
    hostname: str
    cores: int = 1
    memory: int = 512               # MB
    swap: int = 0
    storage: str = "local-lvm"     # storage pool for rootfs
    disk_size: int = 8              # GB
    template: str                   # e.g. "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.gz"
    nics: List[LXCNICConfig] = Field(default_factory=lambda: [LXCNICConfig()])
    password: str = "changeme"
    unprivileged: bool = True
    start_after_create: bool = True


>>>>>>> 6d7c0d87b61f060ea53d17cc0dafdb46f6368e58
@router.post("/nodes/{node}/lxc", status_code=202)
def create_container(node: str, req: CreateLXCRequest) -> dict[str, Any]:
    """Create a new LXC container. Returns task UPID."""
    params: dict[str, Any] = {
        "vmid": req.vmid,
        "hostname": req.hostname,
        "cores": req.cores,
        "memory": req.memory,
        "swap": req.swap,
        "rootfs": f"{req.storage}:{req.disk_size}",
        "ostemplate": req.template,
        "password": req.password,
        "unprivileged": 1 if req.unprivileged else 0,
        "start": 1 if req.start_after_create else 0,
    }
    # Attach all NICs (net0, net1, …) and collect DNS
    dns_servers: list[str] = []
    for idx, nic in enumerate(req.nics):
        params[f"net{idx}"] = nic.to_proxmox_string(iface_index=idx)
        if nic.dns:
            dns_servers.extend(nic.dns.split())

    if dns_servers:
        params["nameserver"] = " ".join(dict.fromkeys(dns_servers))  # deduplicated

    try:
        upid = px_ct.create_container(node, params)
        return {"upid": upid, "node": node, "vmid": req.vmid}
    except Exception as e:
        raise HTTPException(status_code=502, detail=_proxmox_error(e))


@router.post("/nodes/{node}/lxc/{vmid}/{action}", status_code=202)
def container_action(
    node: str,
    vmid: int,
    action: Literal["start", "stop", "reboot", "shutdown", "delete"],
) -> dict[str, Any]:
    """Start, stop, reboot, shutdown, or delete a container."""
    # MOCK INTERCEPT: The dev environment running in Docker cannot handle unprivileged mounts
    if settings.proxmox_mock and node == "pve-01" and action in ("start", "stop"):
        if action == "start":
            MOCK_RUNNING_INSTANCES.add(f"{node}_lxc_{vmid}")
        else:
            MOCK_RUNNING_INSTANCES.discard(f"{node}_lxc_{vmid}")
        mock_upid = f"UPID:{node}:00000000:00000000:00000000:mock{action}:{vmid}:root@pam:"
        return {"upid": mock_upid, "node": node, "vmid": vmid, "action": action}

    try:
        upid = px_ct.action_container(node, vmid, action)
        return {"upid": upid, "node": node, "vmid": vmid, "action": action}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

@router.get("/nodes/{node}/templates")
def get_templates(node: str) -> list[dict[str, Any]]:
    """List available ISOs and LXC templates on the node."""
    return px_tmpl.list_templates(node)


# ---------------------------------------------------------------------------
# Task polling
# ---------------------------------------------------------------------------

@router.get("/tasks/{node}/{upid:path}")
def get_task(node: str, upid: str) -> dict[str, Any]:
    """Poll a Proxmox task by UPID. Returns status and exitstatus when done."""
    if "mockstart" in upid or "mockstop" in upid:
        return {"status": "stopped", "exitstatus": "OK"}

    try:
        return px_vms.get_task_status(node, upid)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
