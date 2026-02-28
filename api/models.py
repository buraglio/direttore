#!/usr/bin/env python3
"""SQLAlchemy ORM models for Direttore."""

import datetime
import enum
from sqlalchemy import Boolean, DateTime, Integer, String, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from api.db import Base


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


# ---------------------------------------------------------------------------
# Auth models
# ---------------------------------------------------------------------------

class Role(str, enum.Enum):
    admin    = "admin"     # Full access: provision, delete, manage users
    operator = "operator"  # Can provision and manage VMs/LXC, cannot manage users
    viewer   = "viewer"    # Read-only: dashboard, resources, reservations

    def permissions(self) -> list[str]:
        """Return the list of permission strings this role grants."""
        base = ["read:dashboard", "read:resources", "read:reservations"]
        if self in (Role.admin, Role.operator):
            base += [
                "write:provision",
                "write:reservations",
                "action:vm_power",
            ]
        if self == Role.admin:
            base += [
                "write:users",
                "delete:resources",
                "read:users",
            ]
        return base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(256), nullable=False)
    role: Mapped[Role] = mapped_column(SAEnum(Role), nullable=False, default=Role.viewer)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.datetime.utcnow
    )
    last_login: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=True)

