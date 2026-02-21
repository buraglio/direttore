#!/usr/bin/env python3
"""Storage pool listing for a Proxmox node."""

from typing import Any, Dict, List
from api.config import settings
from api.proxmox.client import get_client, MOCK_STORAGE

# Content types that indicate a storage pool can hold VM/CT disks
_DISK_CONTENT = {"images", "rootdir"}


def list_storage(node: str) -> List[Dict[str, Any]]:
    """Return storage pools on a node that can hold VM images or CT rootfs."""
    if settings.proxmox_mock:
        return MOCK_STORAGE.get(node, [])
    px = get_client()
    pools = px.nodes(node).storage.get()
    return [
        p for p in pools
        if p.get("enabled", 1) != 0
        and bool(_DISK_CONTENT & set(p.get("content", "").split(",")))
    ]
