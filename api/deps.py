#!/usr/bin/env python3
"""Reusable FastAPI dependency functions for authentication and RBAC."""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import decode_token
from api.db import get_session
from api.models import Role, User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    session: AsyncSession = Depends(get_session),
) -> User:
    """Decode the JWT and return the corresponding active User row."""
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise credentials_exc
        username: str = payload.get("sub", "")
        if not username:
            raise credentials_exc
    except JWTError:
        raise credentials_exc

    result = await session.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise credentials_exc
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*allowed: Role):
    """
    Dependency factory — raises 403 unless the current user has one of the allowed roles.

    Usage::

        @router.post("/nodes/{node}/lxc",
                     dependencies=[Depends(require_roles(Role.admin, Role.operator))])
        async def create_container(...): ...
    """
    async def _guard(user: CurrentUser):
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires one of: {[r.value for r in allowed]}",
            )
        return user
    return _guard


def require_permission(permission: str):
    """
    Dependency factory — raises 403 unless the current user's role grants *permission*.

    Example permissions: "write:provision", "delete:resources", "read:users"
    """
    async def _guard(user: CurrentUser):
        if permission not in user.role.permissions():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission required: {permission}",
            )
        return user
    return _guard
