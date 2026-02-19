#!/usr/bin/env python3
"""FastAPI router — resource reservations and iCAL export."""

import datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from ics import Calendar, Event

from api.db import get_db
from api.models import Reservation, ReservationStatus, ResourceType

router = APIRouter(prefix="/api/reservations", tags=["reservations"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

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


def _to_dict(r: Reservation) -> Dict[str, Any]:
    return {
        "id": r.id,
        "title": r.title,
        "requester": r.requester,
        "resource_type": r.resource_type,
        "proxmox_node": r.proxmox_node,
        "vmid": r.vmid,
        "start_dt": r.start_dt.isoformat(),
        "end_dt": r.end_dt.isoformat(),
        "status": r.status,
        "notes": r.notes,
    }


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

@router.get("/")
async def list_reservations(
    start: Optional[str] = None,
    end: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
) -> List[Dict[str, Any]]:
    """List reservations, optionally filtered by date range."""
    stmt = select(Reservation)
    if start:
        stmt = stmt.where(Reservation.end_dt >= datetime.datetime.fromisoformat(start))
    if end:
        stmt = stmt.where(Reservation.start_dt <= datetime.datetime.fromisoformat(end))
    result = await db.execute(stmt)
    return [_to_dict(r) for r in result.scalars().all()]


@router.post("/", status_code=201)
async def create_reservation(
    body: ReservationCreate, db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Create a reservation after checking for conflicts on the same node."""
    if body.end_dt <= body.start_dt:
        raise HTTPException(status_code=400, detail="end_dt must be after start_dt")

    # Conflict check: same node, overlapping window, not cancelled
    if body.proxmox_node:
        conflict_stmt = select(Reservation).where(
            and_(
                Reservation.proxmox_node == body.proxmox_node,
                Reservation.status != ReservationStatus.cancelled,
                Reservation.start_dt < body.end_dt,
                Reservation.end_dt > body.start_dt,
            )
        )
        conflict = (await db.execute(conflict_stmt)).scalars().first()
        if conflict:
            raise HTTPException(
                status_code=409,
                detail=f"Conflicts with existing reservation #{conflict.id} ('{conflict.title}')",
            )

    r = Reservation(**body.model_dump())
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return _to_dict(r)


@router.get("/{reservation_id}")
async def get_reservation(
    reservation_id: int, db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    r = await db.get(Reservation, reservation_id)
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    return _to_dict(r)


@router.patch("/{reservation_id}")
async def update_reservation(
    reservation_id: int, body: ReservationUpdate, db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    r = await db.get(Reservation, reservation_id)
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(r, field, value)
    await db.commit()
    await db.refresh(r)
    return _to_dict(r)


@router.delete("/{reservation_id}", status_code=204)
async def cancel_reservation(
    reservation_id: int, db: AsyncSession = Depends(get_db)
) -> None:
    r = await db.get(Reservation, reservation_id)
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    r.status = ReservationStatus.cancelled
    await db.commit()


# ---------------------------------------------------------------------------
# iCAL export
# ---------------------------------------------------------------------------

@router.get("/export/ical", response_class=PlainTextResponse)
async def export_ical(db: AsyncSession = Depends(get_db)) -> str:
    """Export all non-cancelled reservations as an iCAL feed."""
    stmt = select(Reservation).where(
        Reservation.status != ReservationStatus.cancelled
    )
    result = await db.execute(stmt)
    reservations = result.scalars().all()

    cal = Calendar()
    for r in reservations:
        e = Event(
            name=f"[{r.resource_type.upper()}] {r.title}",
            begin=r.start_dt,
            end=r.end_dt,
            description=f"Requester: {r.requester}\nNode: {r.proxmox_node}\nVMID: {r.vmid}\n{r.notes or ''}",
        )
        cal.events.add(e)
    return cal.serialize()
