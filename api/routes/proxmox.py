#!/usr/bin/env python3
"""FastAPI router — Proxmox nodes, VMs, containers, task polling."""

from typing import Any, Dict, List, Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.proxmox import client as px_client
from api.proxmox import vms as px_vms
from api.proxmox import containers as px_ct
from api.proxmox import templates as px_tmpl

router = APIRouter(prefix="/api/proxmox", tags=["proxmox"])


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
# VMs
# ---------------------------------------------------------------------------

@router.get("/nodes/{node}/vms")
def get_vms(node: str) -> List[Dict[str, Any]]:
    """List all QEMU VMs on a node."""
    return px_vms.list_vms(node)


class CreateVMRequest(BaseModel):
    vmid: int
    name: str
    cores: int = 2
    memory: int = 2048       # MB
    disk: str = "32G"
    iso: str | None = None   # e.g. "local:iso/ubuntu-22.04.4-live-server-amd64.iso"
    net0: str = "virtio,bridge=vmbr0"
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
        "net0": req.net0,
        "ostype": req.ostype,
    }
    if req.iso:
        params["cdrom"] = req.iso
        params["scsi0"] = f"local-lvm:vm-{req.vmid}-disk-0,size={req.disk}"
    try:
        upid = px_vms.create_vm(node, params)
        return {"upid": upid, "node": node, "vmid": req.vmid}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


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


class CreateLXCRequest(BaseModel):
    vmid: int
    hostname: str
    cores: int = 1
    memory: int = 512        # MB
    swap: int = 0
    rootfs: str = "local-lvm:8"  # storage:size_in_GB
    template: str            # e.g. "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.gz"
    net0: str = "name=eth0,bridge=vmbr0,ip=dhcp"
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
        "rootfs": req.rootfs,
        "ostemplate": req.template,
        "net0": req.net0,
        "password": req.password,
        "unprivileged": 1 if req.unprivileged else 0,
        "start": 1 if req.start_after_create else 0,
    }
    try:
        upid = px_ct.create_container(node, params)
        return {"upid": upid, "node": node, "vmid": req.vmid}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


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
