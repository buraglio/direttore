import datetime

from pydantic import BaseModel
from api.models import ReservationStatus, ResourceType

class ReservationCreate(BaseModel):
    title: str
    requester: str = "anonymous"
    resource_type: ResourceType = ResourceType.vm
    proxmox_node: str | None = None
    vmid: int | None = None
    start_dt: datetime.datetime
    end_dt: datetime.datetime
    notes: str | None = None


class ReservationUpdate(BaseModel):
    title: str | None = None
    status: ReservationStatus | None = None
    proxmox_node: str | None = None
    vmid: int | None = None
    notes: str | None = None
