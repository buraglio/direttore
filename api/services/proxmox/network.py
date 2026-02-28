#!/usr/bin/env python3
"""Network interface listing for a Proxmox node."""

from typing import Any, Dict, List
from api.config import settings
from api.services.proxmox.client import get_client, MOCK_NETWORKS


def list_networks(node: str) -> List[Dict[str, Any]]:
    """Return bridge-type network interfaces on a node."""
    if settings.proxmox_mock:
        return MOCK_NETWORKS.get(node, [])
    px = get_client()
    ifaces = px.nodes(node).network.get()
    return [i for i in ifaces if i.get("type") == "bridge"]
