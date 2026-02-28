from typing import Any, Dict, List, Optional
from pydantic import BaseModel

class NetBoxStatusResponse(BaseModel):
    reachable: bool
    version: Optional[str] = None
    url: Optional[str] = None
    reason: Optional[str] = None

class IPAddressSchema(BaseModel):
    id: int
    address: str
    family: int
    dns_name: str
    description: str
    status: str
    vrf: str
    tags: List[str]
    prefix_gateway: Optional[str] = None
    custom_fields: Dict[str, Any]

class PrefixSchema(BaseModel):
    id: int
    prefix: str
    family: int
    status: str
    vrf: str
    description: str
    site: str
    role: str
    tags: List[str]
    gateway: Optional[str] = None
    dns_servers: str
    custom_fields: Dict[str, Any]

class VLANSchema(BaseModel):
    id: int
    vid: int
    name: str
    status: str
    site: str
    group: str
    role: str
    description: str
    tags: List[str]
    custom_fields: Dict[str, Any]
