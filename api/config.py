#!/usr/bin/env python3
"""Configuration settings loaded from environment / .env file."""

from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Proxmox
    proxmox_host: str = "192.168.1.100"
    proxmox_user: str = "root@pam"
    proxmox_password: str = "changeme"
    proxmox_verify_ssl: bool = False
    proxmox_mock: bool = False  # Set to true for dev without a real Proxmox host

    # NetBox
    netbox_url: str = "http://localhost:8000"
    netbox_token: str = ""

    # Database
    database_url: str = "sqlite+aiosqlite:///./direttore.db"

    # CORS — comma-separated allowed origins
    api_cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # Auth / JWT
    # Generate a secure key with: python -c "import secrets; print(secrets.token_hex(32))"
    jwt_secret_key: str = "CHANGE_ME_in_production_use_a_random_hex_string"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60        # 1 hour
    jwt_refresh_token_expire_days: int = 7

    # First-boot admin account (created automatically if no users exist)
    initial_admin_user: str = "admin"
    initial_admin_password: str = "changeme"

    @property
    def cors_origins(self) -> List[str]:
        return [o.strip() for o in self.api_cors_origins.split(",") if o.strip()]


settings = Settings()
