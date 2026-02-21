#!/usr/bin/env python3
"""FastAPI router — Proxmox nodes, VMs, containers, networks, storage, task polling."""

from typing import Any, Dict, List, Literal, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api.proxmox import client as px_client
from api.proxmox import vms as px_vms
from api.proxmox import containers as px_ct
from api.proxmox import templates as px_tmpl
from api.proxmox import network as px_net
from api.proxmox import storage as px_stor

router = APIRouter(prefix="/api/proxmox", tags=["proxmox"])


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
def get_nodes() -> List[Dict[str, Any]]:
    """List all Proxmox nodes with resource summary."""
    try:
        return px_client.get_nodes()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ---------------------------------------------------------------------------
# Networks
# ---------------------------------------------------------------------------

@router.get("/nodes/{node}/networks")
def get_networks(node: str) -> List[Dict[str, Any]]:
    """List bridge-type network interfaces available on a node."""
    try:
        return px_net.list_networks(node)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

@router.get("/nodes/{node}/storage")
def get_storage(node: str) -> List[Dict[str, Any]]:
    """List storage pools on a node that support VM images or CT rootfs."""
    try:
        return px_stor.list_storage(node)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ---------------------------------------------------------------------------
# VMs
# ---------------------------------------------------------------------------

@router.get("/nodes/{node}/vms")
def get_vms(node: str) -> List[Dict[str, Any]]:
    """List all QEMU VMs on a node."""
    return px_vms.list_vms(node)


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

        Only populated when the user explicitly sets a static IP or IPv6
        address.  We deliberately skip ip='dhcp' here because:
          - ISO-based VMs have no cloud-init drive and Proxmox rejects the param.
          - Cloud-init VMs that want DHCP should leave the field blank (Proxmox
            defaults to DHCP when no ipconfig is provided).
        Callers that genuinely want to pass dhcp via cloud-init can set
        ip='dhcp' and gw or ip6 alongside it; without at least a gateway or
        IPv6 address the field is useless anyway.
        """
        parts: list[str] = []
        # Include ip only when it looks like a real static address (contains '/')
        if self.ip and "/" in (self.ip or ""):
            parts.append(f"ip={self.ip}")
        if self.gw and parts:          # gateway only meaningful with a static ip
            parts.append(f"gw={self.gw}")
        if self.ip6 and self.ip6 not in ("auto", "dhcp6"):
            parts.append(f"ip6={self.ip6}")
        elif self.ip6 in ("auto", "dhcp6"):
            parts.append(f"ip6={self.ip6}")
        if self.gw6:
            parts.append(f"gw6={self.gw6}")
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


@router.post("/nodes/{node}/vms", status_code=202)
def create_vm(node: str, req: CreateVMRequest) -> Dict[str, Any]:
    """Create a new QEMU VM. Returns task UPID."""
    params: Dict[str, Any] = {
        "vmid": req.vmid,
        "name": req.name,
        "cores": req.cores,
        "memory": req.memory,
        "ostype": req.ostype,
    }
    # Attach all NICs (net0, net1, …)
    dns_servers: list[str] = []
    for idx, nic in enumerate(req.nics):
        params[f"net{idx}"] = nic.to_proxmox_net_string()
        ipcfg = nic.to_proxmox_ipconfig_string()
        if ipcfg:
            params[f"ipconfig{idx}"] = ipcfg
        if nic.dns:
            dns_servers.extend(nic.dns.split())

    if dns_servers:
        params["nameserver"] = " ".join(dict.fromkeys(dns_servers))  # deduplicated

    if req.iso:
        params["cdrom"] = req.iso
        params["scsi0"] = f"{req.storage}:vm-{req.vmid}-disk-0,size={req.disk}"

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
) -> Dict[str, Any]:
    """Start, stop, reboot, shutdown, or delete a VM."""
    try:
        upid = px_vms.action_vm(node, vmid, action)
        return {"upid": upid, "node": node, "vmid": vmid, "action": action}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ---------------------------------------------------------------------------
# LXC Containers
# ---------------------------------------------------------------------------

@router.get("/nodes/{node}/lxc")
def get_containers(node: str) -> List[Dict[str, Any]]:
    """List all LXC containers on a node."""
    return px_ct.list_containers(node)


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

    def to_proxmox_string(self) -> str:
        s = f"name={self.name},bridge={self.bridge},ip={self.ip}"
        if self.gw:
            s += f",gw={self.gw}"
        if self.ip6:
            s += f",ip6={self.ip6}"
        if self.gw6:
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


@router.post("/nodes/{node}/lxc", status_code=202)
def create_container(node: str, req: CreateLXCRequest) -> Dict[str, Any]:
    """Create a new LXC container. Returns task UPID."""
    params: Dict[str, Any] = {
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
        params[f"net{idx}"] = nic.to_proxmox_string()
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
) -> Dict[str, Any]:
    """Start, stop, reboot, shutdown, or delete a container."""
    try:
        upid = px_ct.action_container(node, vmid, action)
        return {"upid": upid, "node": node, "vmid": vmid, "action": action}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

@router.get("/nodes/{node}/templates")
def get_templates(node: str) -> List[Dict[str, Any]]:
    """List available ISOs and LXC templates on the node."""
    return px_tmpl.list_templates(node)


# ---------------------------------------------------------------------------
# Task polling
# ---------------------------------------------------------------------------

@router.get("/tasks/{node}/{upid:path}")
def get_task(node: str, upid: str) -> Dict[str, Any]:
    """Poll a Proxmox task by UPID. Returns status and exitstatus when done."""
    try:
        return px_vms.get_task_status(node, upid)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
