#!/usr/bin/env python3
"""User management routes (admin only)."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import hash_password
from api.db import get_session
from api.deps import require_roles
from api.models import Role, User

router = APIRouter(prefix="/api/users", tags=["users"])

AdminOnly = Depends(require_roles(Role.admin))


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class UserOut(BaseModel):
    id: int
    username: str
    role: str
    is_active: bool
    permissions: list[str]

    @classmethod
    def from_orm(cls, u: User) -> "UserOut":
        return cls(
            id=u.id,
            username=u.username,
            role=u.role.value,
            is_active=u.is_active,
            permissions=u.role.permissions(),
        )


class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: Role = Role.viewer

    @field_validator("username")
    @classmethod
    def username_nonempty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("username must not be blank")
        return v

    @field_validator("password")
    @classmethod
    def password_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("password must be at least 8 characters")
        return v


class UpdateUserRequest(BaseModel):
    role: Role | None = None
    is_active: bool | None = None
    password: str | None = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/", response_model=list[UserOut], dependencies=[AdminOnly])
async def list_users(session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(User).order_by(User.id))
    return [UserOut.from_orm(u) for u in result.scalars()]


@router.post("/", response_model=UserOut, status_code=201, dependencies=[AdminOnly])
async def create_user(body: CreateUserRequest, session: AsyncSession = Depends(get_session)):
    existing = await session.execute(select(User).where(User.username == body.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username already exists")
    user = User(
        username=body.username,
        hashed_password=hash_password(body.password),
        role=body.role,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return UserOut.from_orm(user)


@router.patch("/{user_id}", response_model=UserOut, dependencies=[AdminOnly])
async def update_user(
    user_id: int,
    body: UpdateUserRequest,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.password:
        if len(body.password) < 8:
            raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
        user.hashed_password = hash_password(body.password)
    await session.commit()
    await session.refresh(user)
    return UserOut.from_orm(user)


@router.delete("/{user_id}", status_code=204, dependencies=[AdminOnly])
async def delete_user(user_id: int, session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await session.delete(user)
    await session.commit()
