
from pydantic import BaseModel, Field

class NICConfig(BaseModel):
    """Network interface configuration for a QEMU VM."""
    bridge: str = "vmbr0"
    model: str = "virtio"           # virtio | e1000 | rtl8139
    vlan: int | None = Field(None, ge=1, le=4094)  # VLAN tag (None = untagged)
    # IP configuration (used with cloud-init / ipconfig{n})
    ip: str | None = None        # "dhcp" | "x.x.x.x/prefix"
    gw: str | None = None        # IPv4 default gateway
    ip6: str | None = None       # "auto" | "dhcp6" | "x::/prefix"
    gw6: str | None = None       # IPv6 default gateway
    dns: str | None = None       # space-separated nameservers

    def to_proxmox_net_string(self) -> str:
        """Return the net{n} parameter value for the Proxmox API."""
        s = f"{self.model},bridge={self.bridge}"
        if self.vlan is not None:
            s += f",tag={self.vlan}"
        return s

    def to_proxmox_ipconfig_string(self) -> str | None:
        """
        Return the ipconfig{n} value for cloud-init VMs, or None.
        """
        parts: list[str] = []
        if self.ip and "/" in self.ip:
            parts.append(f"ip={self.ip}")
        if self.gw and parts:
            parts.append(f"gw={self.gw}")
        if self.ip6 and self.ip6 not in ("auto", "dhcp6"):
            parts.append(f"ip6={self.ip6}")
        elif self.ip6 in ("auto", "dhcp6"):
            parts.append(f"ip6={self.ip6}")
        if self.gw6:
            parts.append(f"gw6={self.gw6}")
        return ",".join(parts) if parts else None

    def to_proxmox_string(self) -> str:
        return self.to_proxmox_net_string()


class CreateVMRequest(BaseModel):
    vmid: int
    name: str
    cores: int = 2
    memory: int = 2048              # MB
    disk: str = "32G"
    storage: str = "local-lvm"     # storage pool for the primary disk
    iso: str | None = None          # e.g. "local:iso/ubuntu-22.04.4-live-server-amd64.iso"
    nics: list[NICConfig] = Field(default_factory=lambda: [NICConfig()])
    ostype: str = "l26"
    start_after_create: bool = False


class LXCNICConfig(BaseModel):
    """Network interface configuration for an LXC container."""
    name: str = "eth0"              # interface name inside container
    bridge: str = "vmbr0"
    ip: str = "dhcp"                # "dhcp" | "x.x.x.x/prefix"
    gw: str | None = None        # IPv4 default gateway
    ip6: str | None = None       # "auto" | "dhcp6" | "x::/prefix"
    gw6: str | None = None       # IPv6 default gateway
    dns: str | None = None       # space-separated nameservers
    vlan: int | None = Field(None, ge=1, le=4094)

    def to_proxmox_string(self, iface_index: int = 0) -> str:
        """Build the Proxmox net{n} string for this LXC NIC."""
        iface_name = self.name if iface_index == 0 else f"eth{iface_index}"
        s = f"name={iface_name},bridge={self.bridge},ip={self.ip}"
        if self.gw:
            s += f",gw={self.gw}"
        if self.ip6:
            s += f",ip6={self.ip6}"
            if self.gw6:
                s += f",gw6={self.gw6}"
        if self.vlan is not None:
            s += f",tag={self.vlan}"
        return s


class CreateLXCRequest(BaseModel):
    vmid: int
    hostname: str
    cores: int = 1
    memory: int = 512               # MB
    swap: int = 0
    storage: str = "local-lvm"     # storage pool for rootfs
    disk_size: int = 8              # GB
    template: str                   # e.g. "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.gz"
    nics: list[LXCNICConfig] = Field(default_factory=lambda: [LXCNICConfig()])
    password: str = "changeme"
    unprivileged: bool = True
    start_after_create: bool = True
