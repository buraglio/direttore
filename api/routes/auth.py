#!/usr/bin/env python3
"""Authentication routes: login, refresh, whoami."""

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import create_access_token, create_refresh_token, decode_token, verify_password
from api.db import get_session
from api.deps import CurrentUser
from api.models import Role, User

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"

class RefreshRequest(BaseModel):
    refresh_token: str

class WhoAmIResponse(BaseModel):
    id: int
    username: str
    role: str
    permissions: list[str]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/token", response_model=TokenResponse)
async def login(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: AsyncSession = Depends(get_session),
):
    """Exchange username + password for an access + refresh token pair."""
    result = await session.execute(select(User).where(User.username == form.username))
    user: User | None = result.scalar_one_or_none()

    if not user or not user.is_active or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Update last_login
    user.last_login = datetime.now(tz=timezone.utc)
    await session.commit()

    payload = {"sub": user.username, "role": user.role.value}
    return TokenResponse(
        access_token=create_access_token(payload),
        refresh_token=create_refresh_token(payload),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, session: AsyncSession = Depends(get_session)):
    """Exchange a valid refresh token for a new access + refresh token pair."""
    from jose import JWTError
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired refresh token",
    )
    try:
        payload = decode_token(body.refresh_token)
        if payload.get("type") != "refresh":
            raise credentials_exc
        username: str = payload.get("sub", "")
    except JWTError:
        raise credentials_exc

    result = await session.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise credentials_exc

    new_payload = {"sub": user.username, "role": user.role.value}
    return TokenResponse(
        access_token=create_access_token(new_payload),
        refresh_token=create_refresh_token(new_payload),
    )


@router.get("/me", response_model=WhoAmIResponse)
async def whoami(current_user: CurrentUser):
    """Return the authenticated user's profile and permission list."""
    return WhoAmIResponse(
        id=current_user.id,
        username=current_user.username,
        role=current_user.role.value,
        permissions=current_user.role.permissions(),
    )
