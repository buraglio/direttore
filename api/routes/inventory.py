#!/usr/bin/env python3
"""FastAPI router — NetBox inventory proxy."""

from typing import Any
from fastapi import APIRouter, HTTPException, Query
import httpx

from api.schemas.inventory import NetBoxStatusResponse
from api.services.netbox import client as nb

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _clean_params(**kwargs: Any) -> dict[str, Any]:
    """Filter out None or empty values from a dictionary of query parameters."""
    return {k: v for k, v in kwargs.items() if v is not None and v != ""}


# ---------------------------------------------------------------------------
# Reachability
# ---------------------------------------------------------------------------

@router.get("/netbox-status", response_model=NetBoxStatusResponse)
async def netbox_status() -> dict[str, Any]:
    """Quick reachability check against the configured NetBox instance."""
    return await nb.check_status()


# ---------------------------------------------------------------------------
# Devices
# ---------------------------------------------------------------------------

@router.get("/devices")
async def list_devices() -> list[dict[str, Any]]:
    """Proxy NetBox device list."""
    try:
        return await nb.fetch_devices()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"NetBox error: {e}")


# ---------------------------------------------------------------------------
# IP Addresses
# ---------------------------------------------------------------------------

@router.get("/ip-addresses")
async def list_ip_addresses(
    family: int | None = Query(None, description="Address family: 4 or 6"),
    status: str | None = Query(None, description="Filter by status, e.g. active"),
    prefix: str | None = Query(None, description="Filter by parent prefix (CIDR)"),
    dns_name: str | None = Query(None, description="Filter by DNS name (contains)"),
    limit: int = Query(100, le=500),
) -> list[dict[str, Any]]:
    """Return slim NetBox IP addresses enriched with best-effort prefix gateway."""
    params = _clean_params(
        limit=limit,
        family=family,
        status=status,
        parent=prefix,
        dns_name__ic=dns_name,
    )

    try:
        return await nb.fetch_ip_addresses(params, family)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"NetBox error: {e}")


# ---------------------------------------------------------------------------
# Prefixes
# ---------------------------------------------------------------------------

@router.get("/prefixes")
async def list_prefixes(
    family: int | None = Query(None, description="Address family: 4 or 6"),
    status: str | None = Query(None, description="Filter by status, e.g. active"),
    site: str | None = Query(None, description="Filter by site slug"),
    limit: int = Query(200, le=500),
) -> list[dict[str, Any]]:
    """Return NetBox IP prefixes."""
    params = _clean_params(
        limit=limit,
        family=family,
        status=status,
        site=site,
    )

    try:
        return await nb.fetch_prefixes(params)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"NetBox error: {e}")


# ---------------------------------------------------------------------------
# VLANs
# ---------------------------------------------------------------------------


@router.get("/vlans")
async def list_vlans(
    site: str | None = Query(None, description="Filter by site slug"),
    group: str | None = Query(None, description="Filter by VLAN group slug"),
    role: str | None = Query(None, description="Filter by role slug"),
    status: str | None = Query(None, description="Filter by status, e.g. active"),
    q: str | None = Query(None, description="Free-text search (name or description)"),
    limit: int = Query(200, le=500),
) -> list[dict[str, Any]]:
    """Return NetBox VLANs, suitable for populating the VLAN ID field on a NIC."""
    params = _clean_params(
        limit=limit,
        site=site,
        group=group,
        role=role,
        status=status,
        q=q,
    )

    try:
        return await nb.fetch_vlans(params)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"NetBox error: {e}")
