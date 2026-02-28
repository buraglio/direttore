#!/usr/bin/env python3
"""NetBox API client — all HTTP calls and data transformation logic."""

import asyncio
import ipaddress
from typing import Any

import httpx

from api.config import settings

TIMEOUT = 10


def _nb_headers() -> dict[str, str]:
    """Build authentication headers for NetBox API requests."""
    return {
        "Authorization": f"Token {settings.netbox_token}",
        "Accept": "application/json",
    }


# ---------------------------------------------------------------------------
# Data transformers
# ---------------------------------------------------------------------------

def _extract_family(obj: dict[str, Any]) -> Any:
    """Extract the address family value from a NetBox object."""
    family_val = obj.get("family", {})
    return family_val.get("value") if isinstance(family_val, dict) else family_val

def slim_ip(addr: dict[str, Any], gateway: str | None) -> dict[str, Any]:
    """Return a slim, frontend-friendly representation of a NetBox IP address."""
    return {
        "id": addr.get("id"),
        "address": addr.get("address"),
        "family": _extract_family(addr),
        "dns_name": addr.get("dns_name") or "",
        "description": addr.get("description") or "",
        "status": (addr.get("status") or {}).get("value", ""),
        "vrf": (addr.get("vrf") or {}).get("name", "global"),
        "tags": [t.get("name", "") for t in (addr.get("tags") or [])],
        "prefix_gateway": gateway,
        "custom_fields": addr.get("custom_fields") or {},
    }

def slim_prefix(p: dict[str, Any]) -> dict[str, Any]:
    """Return a slim prefix representation including gateway and DNS hints."""
    cf = p.get("custom_fields") or {}
    gw = None
    for key in ("gateway", "default_gateway", "gw"):
        if cf.get(key):
            gw = str(cf[key])
            break
    dns_servers = cf.get("dns_servers") or cf.get("nameservers") or ""
    if isinstance(dns_servers, list):
        dns_servers = " ".join(str(d) for d in dns_servers)

    return {
        "id": p.get("id"),
        "prefix": p.get("prefix"),
        "family": _extract_family(p),
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

def slim_vlan(v: dict[str, Any]) -> dict[str, Any]:
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

# ---------------------------------------------------------------------------
# Gateway / prefix matching helpers
# ---------------------------------------------------------------------------

def gateway_from_prefix(prefix: dict[str, Any]) -> str | None:
    """Extract a gateway value from a prefix object's custom_fields or description."""
    cf = prefix.get("custom_fields") or {}
    for key in ("gateway", "default_gateway", "gw"):
        if cf.get(key):
            return str(cf[key])
    desc = prefix.get("description") or ""
    if desc and "/" not in desc and ("." in desc or ":" in desc):
        return desc.strip()
    return None

def match_gateway(
    address: str, prefix_gw_map: dict[str, str | None]
) -> str | None:
    """
    Longest-prefix match: given an IP address (no mask) find the most specific
    prefix from prefix_gw_map and return its gateway.
    """
    try:
        ip_obj = ipaddress.ip_address(address)
    except ValueError:
        return None
    best: str | None = None
    best_len = -1
    for cidr, gw in prefix_gw_map.items():
        try:
            net = ipaddress.ip_network(cidr, strict=False)
            if ip_obj in net and net.prefixlen > best_len:
                best = gw
                best_len = net.prefixlen
        except ValueError:
            continue
    return best

# ---------------------------------------------------------------------------
# NetBox API calls
# ---------------------------------------------------------------------------

async def check_status() -> dict[str, Any]:
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

async def fetch_devices() -> list[dict[str, Any]]:
    """Fetch all devices from NetBox."""
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.get(
            f"{settings.netbox_url}/api/dcim/devices/",
            headers=_nb_headers(),
        )
        r.raise_for_status()
        return r.json().get("results", [])

async def _bulk_prefix_gateway_map(
    client: httpx.AsyncClient,
    family: int | None = None,
) -> dict[str, str | None]:
    """
    Fetch all prefixes in one call and return a dict mapping prefix CIDR to
    gateway.  Used to avoid N sequential gateway lookups when enriching IPs.
    """
    params: dict[str, Any] = {"limit": 500}
    if family:
        params["family"] = family
    try:
        r = await client.get(
            f"{settings.netbox_url}/api/ipam/prefixes/",
            params=params,
            headers=_nb_headers(),
        )
        r.raise_for_status()
        return {
            p["prefix"]: gateway_from_prefix(p)
            for p in r.json().get("results", [])
            if p.get("prefix")
        }
    except Exception:
        return {}

async def fetch_ip_addresses(
    params: dict[str, Any],
    family: int | None = None,
) -> list[dict[str, Any]]:
    """
    Fetch IP addresses from NetBox, enriched with best-effort prefix gateway
    via a single bulk prefix fetch (no per-address HTTP calls).
    """
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        addrs_resp, prefix_gw_map = await asyncio.gather(
            client.get(
                f"{settings.netbox_url}/api/ipam/ip-addresses/",
                params=params,
                headers=_nb_headers(),
            ),
            _bulk_prefix_gateway_map(client, family),
        )
        addrs_resp.raise_for_status()
        addrs = addrs_resp.json().get("results", [])

        results: list[dict[str, Any]] = []
        for addr in addrs:
            raw_ip = (addr.get("address") or "").split("/")[0]
            gw = match_gateway(raw_ip, prefix_gw_map)
            results.append(slim_ip(addr, gw))
        return results

async def fetch_prefixes(params: dict[str, Any]) -> list[dict[str, Any]]:
    """Fetch prefixes from NetBox, transformed to slim representation."""
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.get(
            f"{settings.netbox_url}/api/ipam/prefixes/",
            params=params,
            headers=_nb_headers(),
        )
        r.raise_for_status()
        return [slim_prefix(p) for p in r.json().get("results", [])]

async def fetch_vlans(params: dict[str, Any]) -> list[dict[str, Any]]:
    """Fetch VLANs from NetBox, transformed to slim representation."""
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.get(
            f"{settings.netbox_url}/api/ipam/vlans/",
            params=params,
            headers=_nb_headers(),
        )
        r.raise_for_status()
        return [slim_vlan(v) for v in r.json().get("results", [])]
