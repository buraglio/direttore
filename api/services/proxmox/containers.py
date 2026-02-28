"""LXC container operations against Proxmox."""

import uuid
from typing import Any

from api.config import settings
from api.services.proxmox.client import get_client, MOCK_LXC


def list_containers(node: str) -> list[dict[str, Any]]:
    if settings.proxmox_mock:
        return MOCK_LXC.get(node, [])
    px = get_client()
    return px.nodes(node).lxc.get()


def create_container(node: str, params: dict[str, Any]) -> str:
    """Create an LXC container. Returns UPID."""
    if settings.proxmox_mock:
        return f"UPID:{node}:mock-{uuid.uuid4().hex[:8]}:lxccreate"
    px = get_client()
    return px.nodes(node).lxc.post(**params)


def action_container(node: str, vmid: int, action: str) -> str:
    """Perform start / stop / reboot / shutdown / delete on a container. Returns UPID."""
    if settings.proxmox_mock:
        return f"UPID:{node}:mock-{uuid.uuid4().hex[:8]}:{action}"
    px = get_client()
    ct = px.nodes(node).lxc(vmid)
    dispatch = {
        "start": ct.status.start.post,
        "stop": ct.status.stop.post,
        "reboot": ct.status.reboot.post,
        "shutdown": ct.status.shutdown.post,
        "delete": ct.delete,
    }
    if action not in dispatch:
        raise ValueError(f"Unknown container action: {action}")
    return dispatch[action]()
