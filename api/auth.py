#!/usr/bin/env python3
"""JWT token creation / verification and password hashing utilities."""

from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from api.config import settings

# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd_context.verify(plain, hashed)


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def create_access_token(payload: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Return a signed JWT access token."""
    data = payload.copy()
    expire = _now() + (expires_delta or timedelta(minutes=settings.jwt_access_token_expire_minutes))
    data["exp"] = expire
    data["type"] = "access"
    return jwt.encode(data, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_refresh_token(payload: dict) -> str:
    """Return a signed JWT refresh token (longer-lived)."""
    data = payload.copy()
    data["exp"] = _now() + timedelta(days=settings.jwt_refresh_token_expire_days)
    data["type"] = "refresh"
    return jwt.encode(data, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    """Decode and verify a JWT.  Raises JWTError on failure."""
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
