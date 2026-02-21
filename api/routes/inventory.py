#!/usr/bin/env python3
"""FastAPI router — NetBox inventory proxy."""

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query
import httpx

from api.config import settings

router = APIRouter(prefix="/api/inventory", tags=["inventory"])

TIMEOUT = 10  # seconds


def _nb_headers() -> Dict[str, str]:
    return {
        "Authorization": f"Token {settings.netbox_token}",
        "Accept": "application/json",
    }


# ---------------------------------------------------------------------------
# Reachability
# ---------------------------------------------------------------------------

@router.get("/netbox-status")
async def netbox_status() -> Dict[str, Any]:
    """Quick reachability check against the configured NetBox instance."""
    if not settings.netbox_token:
        return {"reachable": False, "reason": "NETBOX_TOKEN not configured"}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(
                f"{settings.netbox_url}/api/status/",
                headers=_nb_headers(),
            )
            r.raise_for_status()
            data = r.json()
            return {
                "reachable": True,
                "version": data.get("netbox-version", "unknown"),
                "url": settings.netbox_url,
            }
    except Exception as e:
        return {"reachable": False, "reason": str(e)}


# ---------------------------------------------------------------------------
# Devices
# ---------------------------------------------------------------------------

@router.get("/devices")
async def list_devices() -> List[Dict[str, Any]]:
    """Proxy NetBox device list."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(
                f"{settings.netbox_url}/api/dcim/devices/",
                headers=_nb_headers(),
            )
            r.raise_for_status()
            return r.json().get("results", [])
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"NetBox error: {e}")


# ---------------------------------------------------------------------------
# IP Addresses
# ---------------------------------------------------------------------------

def _slim_ip(addr: Dict[str, Any], gateway: Optional[str]) -> Dict[str, Any]:
    """Return a slim, frontend-friendly representation of a NetBox IP address."""
    family_val = addr.get("family", {})
    family = (
        family_val.get("value")
        if isinstance(family_val, dict)
        else family_val
    )
    return {
        "id": addr.get("id"),
        "address": addr.get("address"),
        "family": family,
        "dns_name": addr.get("dns_name") or "",
        "description": addr.get("description") or "",
        "status": (addr.get("status") or {}).get("value", ""),
        "vrf": (addr.get("vrf") or {}).get("name", "global"),
        "tags": [t.get("name", "") for t in (addr.get("tags") or [])],
        "prefix_gateway": gateway,
        # Custom fields passthrough
        "custom_fields": addr.get("custom_fields") or {},
    }


async def _fetch_gateway_for(address: str, client: httpx.AsyncClient) -> Optional[str]:
    """
    Best-effort: find the gateway for an address by querying its parent prefix.
    Checks custom_fields.gateway first, then falls back to the prefix description.
    """
    try:
        r = await client.get(
            f"{settings.netbox_url}/api/ipam/prefixes/",
            params={"contains": address},
            headers=_nb_headers(),
        )
        r.raise_for_status()
        results = r.json().get("results", [])
        if not results:
            return None
        # Narrowest-match prefix first (NetBox returns longest-match first)
        prefix = results[0]
        cf = prefix.get("custom_fields") or {}
        # Try common custom field names for gateway
        for key in ("gateway", "default_gateway", "gw"):
            if cf.get(key):
                return str(cf[key])
        # Fall back to description (some orgs put GW there)
        desc = prefix.get("description") or ""
        if desc and "/" not in desc and "." in desc:
            return desc.strip()
        return None
    except Exception:
        return None


@router.get("/ip-addresses")
async def list_ip_addresses(
    family: Optional[int] = Query(None, description="Address family: 4 or 6"),
    status: Optional[str] = Query(None, description="Filter by status, e.g. active"),
    prefix: Optional[str] = Query(None, description="Filter by parent prefix (CIDR)"),
    dns_name: Optional[str] = Query(None, description="Filter by DNS name (contains)"),
    limit: int = Query(200, le=500),
) -> List[Dict[str, Any]]:
    """
    Return a slim list of NetBox IP addresses, enriched with a best-effort
    prefix_gateway field derived from the parent prefix.
    """
    params: Dict[str, Any] = {"limit": limit}
    if family is not None:
        params["family"] = family
    if status:
        params["status"] = status
    if prefix:
        params["parent"] = prefix
    if dns_name:
        params["dns_name__ic"] = dns_name  # case-insensitive contains

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(
                f"{settings.netbox_url}/api/ipam/ip-addresses/",
                params=params,
                headers=_nb_headers(),
            )
            r.raise_for_status()
            addrs = r.json().get("results", [])

            # Enrich each address with a gateway from its parent prefix.
            # We batch the gateway lookups but cap to avoid hammering NetBox.
            results: List[Dict[str, Any]] = []
            for addr in addrs:
                raw_address = addr.get("address", "").split("/")[0]
                gw = await _fetch_gateway_for(raw_address, client)
                results.append(_slim_ip(addr, gw))
            return results
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"NetBox error: {e}")


# ---------------------------------------------------------------------------
# Prefixes
# ---------------------------------------------------------------------------

def _slim_prefix(p: Dict[str, Any]) -> Dict[str, Any]:
    """Return a slim prefix representation including gateway and DNS hints."""
    cf = p.get("custom_fields") or {}
    # Try common custom field names for gateway and DNS
    gw = None
    for key in ("gateway", "default_gateway", "gw"):
        if cf.get(key):
            gw = str(cf[key])
            break
    dns_servers = cf.get("dns_servers") or cf.get("nameservers") or ""
    if isinstance(dns_servers, list):
        dns_servers = " ".join(str(d) for d in dns_servers)

    family_val = p.get("family", {})
    family = (
        family_val.get("value")
        if isinstance(family_val, dict)
        else family_val
    )
    return {
        "id": p.get("id"),
        "prefix": p.get("prefix"),
        "family": family,
        "status": (p.get("status") or {}).get("value", ""),
        "vrf": (p.get("vrf") or {}).get("name", "global"),
        "description": p.get("description") or "",
        "site": (p.get("site") or {}).get("name", ""),
        "role": (p.get("role") or {}).get("name", ""),
        "tags": [t.get("name", "") for t in (p.get("tags") or [])],
        "gateway": gw,
        "dns_servers": dns_servers,
        "custom_fields": cf,
    }


@router.get("/prefixes")
async def list_prefixes(
    family: Optional[int] = Query(None, description="Address family: 4 or 6"),
    status: Optional[str] = Query(None, description="Filter by status, e.g. active"),
    site: Optional[str] = Query(None, description="Filter by site slug"),
    limit: int = Query(200, le=500),
) -> List[Dict[str, Any]]:
    """Return NetBox IP prefixes enriched with gateway and DNS server hints."""
    params: Dict[str, Any] = {"limit": limit}
    if family is not None:
        params["family"] = family
    if status:
        params["status"] = status
    if site:
        params["site"] = site

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(
                f"{settings.netbox_url}/api/ipam/prefixes/",
                params=params,
                headers=_nb_headers(),
            )
            r.raise_for_status()
            return [_slim_prefix(p) for p in r.json().get("results", [])]
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"NetBox error: {e}")


# ---------------------------------------------------------------------------
# VLANs
# ---------------------------------------------------------------------------

def _slim_vlan(v: Dict[str, Any]) -> Dict[str, Any]:
    """Return a slim VLAN representation."""
    return {
        "id": v.get("id"),
        "vid": v.get("vid"),
        "name": v.get("name") or "",
        "status": (v.get("status") or {}).get("value", ""),
        "site": (v.get("site") or {}).get("name", ""),
        "group": (v.get("group") or {}).get("name", ""),
        "role": (v.get("role") or {}).get("name", ""),
        "description": v.get("description") or "",
        "tags": [t.get("name", "") for t in (v.get("tags") or [])],
        "custom_fields": v.get("custom_fields") or {},
    }


@router.get("/vlans")
async def list_vlans(
    site: Optional[str] = Query(None, description="Filter by site slug"),
    group: Optional[str] = Query(None, description="Filter by VLAN group slug"),
    role: Optional[str] = Query(None, description="Filter by role slug"),
    status: Optional[str] = Query(None, description="Filter by status, e.g. active"),
    q: Optional[str] = Query(None, description="Free-text search (name or description)"),
    limit: int = Query(200, le=500),
) -> List[Dict[str, Any]]:
    """Return NetBox VLANs, suitable for populating the VLAN ID field on a NIC."""
    params: Dict[str, Any] = {"limit": limit}
    if site:
        params["site"] = site
    if group:
        params["group"] = group
    if role:
        params["role"] = role
    if status:
        params["status"] = status
    if q:
        params["q"] = q

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(
                f"{settings.netbox_url}/api/ipam/vlans/",
                params=params,
                headers=_nb_headers(),
            )
            r.raise_for_status()
            return [_slim_vlan(v) for v in r.json().get("results", [])]
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"NetBox error: {e}")
