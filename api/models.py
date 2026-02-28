"""SQLAlchemy ORM models for Direttore."""

import datetime
from sqlalchemy import DateTime, Integer, String, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from api.db import Base
import enum


class ResourceType(str, enum.Enum):
    vm = "vm"
    lxc = "lxc"


class ReservationStatus(str, enum.Enum):
    pending = "pending"
    active = "active"
    completed = "completed"
    cancelled = "cancelled"


class Reservation(Base):
    __tablename__ = "reservations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    requester: Mapped[str] = mapped_column(String(64), nullable=False, default="anonymous")
    resource_type: Mapped[ResourceType] = mapped_column(
        SAEnum(ResourceType), nullable=False, default=ResourceType.vm
    )
    proxmox_node: Mapped[str] = mapped_column(String(64), nullable=True)
    vmid: Mapped[int] = mapped_column(Integer, nullable=True)
    start_dt: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False)
    end_dt: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False)
    status: Mapped[ReservationStatus] = mapped_column(
        SAEnum(ReservationStatus), nullable=False, default=ReservationStatus.pending
    )
    notes: Mapped[str] = mapped_column(String(512), nullable=True)


class ResourcePool(Base):
    __tablename__ = "resource_pools"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    proxmox_node: Mapped[str] = mapped_column(String(64), nullable=False)
    max_vms: Mapped[int] = mapped_column(Integer, default=10)
    max_lxc: Mapped[int] = mapped_column(Integer, default=20)
