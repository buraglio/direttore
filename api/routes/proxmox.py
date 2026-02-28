"""FastAPI router — Proxmox nodes, VMs, containers, networks, storage, task polling."""

from typing import Any, Dict, List, Literal, Optional
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
    # Attach NICs (net0, net1, …).
    for idx, nic in enumerate(req.nics):
        params[f"net{idx}"] = nic.to_proxmox_net_string()

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
