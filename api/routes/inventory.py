#!/usr/bin/env python3
"""FastAPI router — NetBox inventory proxy."""

<<<<<<< HEAD
from typing import Any
=======
from typing import Any, Dict, List, Optional
from datetime import datetime
from pydantic import BaseModel
>>>>>>> 6d7c0d87b61f060ea53d17cc0dafdb46f6368e58
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

from pydantic import BaseModel
from datetime import datetime

class AllocateIPRequest(BaseModel):
    description: Optional[str] = None

@router.post("/prefixes/{prefix_id}/allocate")
async def allocate_prefix_ip(prefix_id: int, req: AllocateIPRequest) -> Dict[str, Any]:
    """Allocate the next available IP inside a specific prefix in NetBox."""
    desc = req.description or f"Allocated by Direttore on {datetime.now().isoformat()}"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            # Fetch the prefix first to get any statically defined gateway
            prefix_r = await client.get(
                f"{settings.netbox_url}/api/ipam/prefixes/{prefix_id}/",
                headers=_nb_headers()
            )
            gate = None
            if prefix_r.status_code == 200:
                p_data = _slim_prefix(prefix_r.json())
                gate = p_data.get("gateway")

            data = None
            for _ in range(10):  # Retry loop to skip network/gateway addresses
                r = await client.post(
                    f"{settings.netbox_url}/api/ipam/prefixes/{prefix_id}/available-ips/",
                    json={"description": desc},
                    headers=_nb_headers(),
                )
                r.raise_for_status()
                data = r.json()
                if isinstance(data, list) and len(data) > 0:
                    data = data[0]
                
                raw_ip = data.get("address", "").split("/")[0]
                is_network = raw_ip.endswith("::") or raw_ip.endswith(".0")
                is_potential_gw = raw_ip.endswith("::1") or raw_ip.endswith(".1")
                
                skip_msg = None
                
                if is_network:
                    skip_msg = "Reserved (Network address skipped by Direttore)"
                elif is_potential_gw:
                    if gate:
                        # Gateway already specified elsewhere, just skip this IP
                        skip_msg = "Reserved (skipped ::1 or .1 by Direttore)"
                    else:
                        # No gateway specified! Let's assume this IS the gateway.
                        skip_msg = "Allocated as gateway by Direttore"
                        gate = raw_ip  # We assume this is the gateway now!
                
                if skip_msg:
                    # Burn this address: update description so it's not reused
                    ip_id = data.get("id")
                    if ip_id:
                        await client.patch(
                            f"{settings.netbox_url}/api/ipam/ip-addresses/{ip_id}/",
                            json={"description": skip_msg},
                            headers=_nb_headers()
                        )
                    continue  # Try allocating the next one
                break  # Good address found!

            if not data:
                raise HTTPException(status_code=502, detail="Exhausted available IPs while skipping network/gateway addresses.")

            return _slim_ip(data, gateway=gate)
    except httpx.HTTPError as e:
        detail = str(e)
        if hasattr(e, "response") and e.response is not None:
            try:
                detail = e.response.json()
            except Exception:
                pass
        raise HTTPException(status_code=502, detail=f"NetBox error: {detail}")


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
