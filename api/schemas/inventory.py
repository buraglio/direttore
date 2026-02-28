from typing import Any
from pydantic import BaseModel

class NetBoxStatusResponse(BaseModel):
    reachable: bool
    version: str | None = None
    url: str | None = None
    reason: str | None = None

class IPAddressSchema(BaseModel):
    id: int
    address: str
    family: int
    dns_name: str
    description: str
    status: str
    vrf: str
    tags: list[str]
    prefix_gateway: str | None = None
    custom_fields: dict[str, Any]

class PrefixSchema(BaseModel):
    id: int
    prefix: str
    family: int
    status: str
    vrf: str
    description: str
    site: str
    role: str
    tags: list[str]
    gateway: str | None = None
    dns_servers: str
    custom_fields: dict[str, Any]

class VLANSchema(BaseModel):
    id: int
    vid: int
    name: str
    status: str
    site: str
    group: str
    role: str
    description: str
    tags: list[str]
    custom_fields: dict[str, Any]
