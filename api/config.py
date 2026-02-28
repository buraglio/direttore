"""Configuration settings loaded from environment / .env file."""


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

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.api_cors_origins.split(",") if o.strip()]


settings = Settings()
