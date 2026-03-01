"""QEMU VM operations against Proxmox."""

import uuid
from typing import Any

from api.config import settings
from api.services.proxmox.client import get_client, MOCK_VMS


def list_vms(node: str) -> list[dict[str, Any]]:
    if settings.proxmox_mock:
        return MOCK_VMS.get(node, [])
    px = get_client()
    return px.nodes(node).qemu.get()


def create_vm(node: str, params: dict[str, Any]) -> str:
    """Create a QEMU VM and return the UPID task identifier."""
    if settings.proxmox_mock:
        task_id = f"UPID:{node}:mock-{uuid.uuid4().hex[:8]}:qmcreate"
        return task_id
    px = get_client()
    result = px.nodes(node).qemu.post(**params)
    return result  # result is the UPID string


def action_vm(node: str, vmid: int, action: str) -> str:
    """Perform start / stop / reboot / shutdown / delete on a VM. Returns UPID."""
    if settings.proxmox_mock:
        return f"UPID:{node}:mock-{uuid.uuid4().hex[:8]}:{action}"
    px = get_client()
    vm = px.nodes(node).qemu(vmid)
    dispatch = {
        "start": vm.status.start.post,
        "stop": vm.status.stop.post,
        "reboot": vm.status.reboot.post,
        "shutdown": vm.status.shutdown.post,
        "delete": vm.delete,
    }
    if action not in dispatch:
        raise ValueError(f"Unknown VM action: {action}")
    return dispatch[action]()


def get_task_status(node: str, upid: str) -> dict[str, Any]:
    """Poll task status. In mock mode, simulate completion after a brief delay."""
    if settings.proxmox_mock:
        # Simulate progress based on task age embedded in upid (mock always completes)
        return {"upid": upid, "status": "stopped", "exitstatus": "OK", "node": node}
    px = get_client()
    return px.nodes(node).tasks(upid).status.get()

def get_vm_details(node: str, vmid: int) -> dict[str, Any]:
    """Fetch full configuration and current status for a VM."""
    if settings.proxmox_mock:
        return {
            "config": {"name": f"mock-vm-{vmid}", "cores": 2, "memory": 2048, "scsi0": "local:32G"},
            "status": {"status": "stopped", "uptime": 12345, "cpu": 0.05, "maxmem": 2048*1024*1024, "maxdisk": 32*1024*1024*1024}
        }
    px = get_client()
    vm = px.nodes(node).qemu(vmid)
    config = vm.config.get()
    status = vm.status.current.get()
    return {"config": config, "status": status}
