"""Retrieve available templates/ISOs from Proxmox storage."""

from typing import Any

from api.config import settings
from api.services.proxmox.client import get_client, MOCK_TEMPLATES


def list_templates(node: str) -> list[dict[str, Any]]:
    """Return all ISOs and container templates available on the node's local storage."""
    if settings.proxmox_mock:
        return MOCK_TEMPLATES.get(node, [])
    px = get_client()
    # Query both iso and vztmpl content types from local storage
    items = []
    for content in ("iso", "vztmpl"):
        try:
            results = px.nodes(node).storage("local").content.get(content=content)
            items.extend(results)
        except Exception:
            pass
    return items
