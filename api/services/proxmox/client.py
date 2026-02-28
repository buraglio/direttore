#!/usr/bin/env python3
"""Proxmox API client — wraps proxmoxer with mock support."""

from typing import Any, Dict, List
from api.config import settings

_proxmox = None


def get_client():
    """Return a cached proxmoxer ProxmoxAPI instance (or None in mock mode)."""
    global _proxmox
    if settings.proxmox_mock:
        return None
    if _proxmox is None:
        from proxmoxer import ProxmoxAPI  # type: ignore
        _proxmox = ProxmoxAPI(
            settings.proxmox_host,
            user=settings.proxmox_user,
            password=settings.proxmox_password,
            verify_ssl=settings.proxmox_verify_ssl,
        )
    return _proxmox


# ---------------------------------------------------------------------------
# Mock data — returned when PROXMOX_MOCK=true
# ---------------------------------------------------------------------------

MOCK_NODES: List[Dict[str, Any]] = [
    {
        "node": "pve-01",
        "status": "online",
        "cpu": 0.23,
        "maxcpu": 32,
        "mem": 17_179_869_184,
        "maxmem": 68_719_476_736,
        "disk": 107_374_182_400,
        "maxdisk": 1_099_511_627_776,
        "uptime": 864000,
    },
    {
        "node": "pve-02",
        "status": "online",
        "cpu": 0.41,
        "maxcpu": 16,
        "mem": 8_589_934_592,
        "maxmem": 34_359_738_368,
        "disk": 53_687_091_200,
        "maxdisk": 549_755_813_888,
        "uptime": 432000,
    },
]

MOCK_VMS: Dict[str, List[Dict[str, Any]]] = {
    "pve-01": [
        {"vmid": 100, "name": "ubuntu-22-04", "status": "running", "cpus": 4, "maxmem": 4_294_967_296, "uptime": 76400, "type": "qemu"},
        {"vmid": 101, "name": "win2022-template", "status": "stopped", "cpus": 8, "maxmem": 8_589_934_592, "uptime": 0, "type": "qemu"},
        {"vmid": 102, "name": "rocky-linux-9", "status": "running", "cpus": 2, "maxmem": 2_147_483_648, "uptime": 12300, "type": "qemu"},
    ],
    "pve-02": [
        {"vmid": 200, "name": "debian-12", "status": "running", "cpus": 2, "maxmem": 2_147_483_648, "uptime": 43200, "type": "qemu"},
        {"vmid": 201, "name": "test-router", "status": "paused", "cpus": 1, "maxmem": 1_073_741_824, "uptime": 0, "type": "qemu"},
    ],
}

MOCK_LXC: Dict[str, List[Dict[str, Any]]] = {
    "pve-01": [
        {"vmid": 300, "name": "alpine-dns", "status": "running", "cpus": 1, "maxmem": 536_870_912, "uptime": 99000, "type": "lxc"},
        {"vmid": 301, "name": "ubuntu-web", "status": "stopped", "cpus": 2, "maxmem": 1_073_741_824, "uptime": 0, "type": "lxc"},
    ],
    "pve-02": [
        {"vmid": 400, "name": "monitoring", "status": "running", "cpus": 2, "maxmem": 2_147_483_648, "uptime": 55000, "type": "lxc"},
    ],
}

MOCK_TEMPLATES: Dict[str, List[Dict[str, Any]]] = {
    "pve-01": [
        {"volid": "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.gz", "content": "vztmpl", "size": 122_683_392},
        {"volid": "local:vztmpl/debian-12-standard_12.0-1_amd64.tar.gz", "content": "vztmpl", "size": 89_400_320},
        {"volid": "local:iso/ubuntu-22.04.4-live-server-amd64.iso", "content": "iso", "size": 2_100_000_000},
        {"volid": "local:iso/Rocky-9.4-x86_64-minimal.iso", "content": "iso", "size": 1_600_000_000},
    ],
    "pve-02": [
        {"volid": "local:vztmpl/alpine-3.18-default_20230901_amd64.tar.xz", "content": "vztmpl", "size": 3_145_728},
    ],
}

MOCK_NETWORKS: Dict[str, List[Dict[str, Any]]] = {
    "pve-01": [
        {"iface": "vmbr0", "type": "bridge", "active": 1, "comments": "Main LAN bridge"},
        {"iface": "vmbr1", "type": "bridge", "active": 1, "comments": "Lab VLAN trunk"},
        {"iface": "vmbr2", "type": "bridge", "active": 0, "comments": "Storage network (inactive)"},
    ],
    "pve-02": [
        {"iface": "vmbr0", "type": "bridge", "active": 1, "comments": "Main LAN bridge"},
        {"iface": "vmbr1", "type": "bridge", "active": 1, "comments": "Lab VLAN trunk"},
    ],
}

MOCK_STORAGE: Dict[str, List[Dict[str, Any]]] = {
    "pve-01": [
        {
            "storage": "local-lvm", "type": "lvmthin", "content": "rootdir,images",
            "avail": 450_000_000_000, "total": 1_099_511_627_776, "enabled": 1,
        },
        {
            "storage": "local", "type": "dir", "content": "vztmpl,iso,backup,rootdir",
            "avail": 48_318_382_080, "total": 107_374_182_400, "enabled": 1,
        },
        {
            "storage": "ceph-pool", "type": "rbd", "content": "rootdir,images",
            "avail": 2_199_023_255_552, "total": 5_497_558_138_880, "enabled": 1,
        },
    ],
    "pve-02": [
        {
            "storage": "local-lvm", "type": "lvmthin", "content": "rootdir,images",
            "avail": 214_748_364_800, "total": 549_755_813_888, "enabled": 1,
        },
        {
            "storage": "local", "type": "dir", "content": "vztmpl,iso,backup,rootdir",
            "avail": 30_064_771_072, "total": 107_374_182_400, "enabled": 1,
        },
    ],
}


def get_nodes() -> List[Dict[str, Any]]:
    if settings.proxmox_mock:
        return MOCK_NODES
    px = get_client()
    return px.nodes.get()
