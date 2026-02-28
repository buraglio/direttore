import datetime
from typing import Optional
from pydantic import BaseModel
from api.models import ReservationStatus, ResourceType

class ReservationCreate(BaseModel):
    title: str
    requester: str = "anonymous"
    resource_type: ResourceType = ResourceType.vm
    proxmox_node: Optional[str] = None
    vmid: Optional[int] = None
    start_dt: datetime.datetime
    end_dt: datetime.datetime
    notes: Optional[str] = None


class ReservationUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[ReservationStatus] = None
    proxmox_node: Optional[str] = None
    vmid: Optional[int] = None
    notes: Optional[str] = None
