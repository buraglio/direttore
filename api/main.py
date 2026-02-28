#!/usr/bin/env python3
"""Direttore FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from api.config import settings
from api.db import AsyncSessionLocal, init_db
from api.routes import proxmox, reservations, inventory
from api.routes import auth as auth_router
from api.routes import users as users_router

logger = logging.getLogger(__name__)


async def _seed_admin() -> None:
    """Create the initial admin user if the users table is empty."""
    from api.auth import hash_password
    from api.models import Role, User

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User))
        if result.first() is not None:
            return  # users already exist — skip seeding

        admin = User(
            username=settings.initial_admin_user,
            hashed_password=hash_password(settings.initial_admin_password),
            role=Role.admin,
            is_active=True,
        )
        session.add(admin)
        await session.commit()
        logger.warning(
            "⚠  Created initial admin user '%s'. "
            "Change the password immediately via /api/users/<id> or the Users page.",
            settings.initial_admin_user,
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await _seed_admin()
    yield


app = FastAPI(
    title="Direttore API",
    description="Lab infrastructure provisioning and reservation platform",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(users_router.router)
app.include_router(proxmox.router)
app.include_router(reservations.router)
app.include_router(inventory.router)


@app.get("/healthz")
def health() -> dict:
    return {"status": "ok", "mock_mode": settings.proxmox_mock}
