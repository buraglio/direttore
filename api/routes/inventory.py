#!/usr/bin/env python3
"""FastAPI router — NetBox inventory proxy."""

from typing import Any, Dict, List
from fastapi import APIRouter, HTTPException
import httpx

from api.config import settings

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


def _nb_headers() -> Dict[str, str]:
    return {"Authorization": f"Token {settings.netbox_token}"}


@router.get("/devices")
async def list_devices() -> List[Dict[str, Any]]:
    """Proxy NetBox device list."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{settings.netbox_url}/api/dcim/devices/",
                headers=_nb_headers(),
            )
            r.raise_for_status()
            return r.json().get("results", [])
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"NetBox error: {e}")


@router.get("/prefixes")
async def list_prefixes() -> List[Dict[str, Any]]:
    """Proxy NetBox IP prefix list."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{settings.netbox_url}/api/ipam/prefixes/",
                headers=_nb_headers(),
            )
            r.raise_for_status()
            return r.json().get("results", [])
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"NetBox error: {e}")
