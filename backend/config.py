import os
import secrets
import logging
from pydantic_settings import BaseSettings
from pydantic import field_validator
from typing import List, Optional

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    # Database
    database_url: str = "sqlite:///./nagelfluh.db"

    # File Storage (Legacy - for backward compatibility)
    data_base_path: str = "file://./data_storage"

    # Per-Project Bucket Storage
    storage_protocol: str = "s3"  # s3, gcs, az, or file
    storage_endpoint: str = "http://localhost:9000"  # MinIO URL; overridden by k8s ConfigMap in prod
    storage_bucket_prefix: str = "nagelfluh-project-"

    # MinIO Admin Credentials (for bucket/user management)
    minio_root_user: str = "minioadmin"
    minio_root_password: str = "minioadmin"

    # Authentication
    jwt_secret_key: Optional[str] = None
    jwt_algorithm: str = "HS256"
    access_token_expire_days: int = 30

    # Application
    process_cost: float = 0.10
    initial_user_balance: float = 100.0

    # CORS
    cors_origins: List[str] = ["http://localhost:3000"]

    # Backend API base URL
    backend_base_url: str = "http://localhost:8000"

    # Frontend base URL (used for invite links)
    frontend_base_url: str = "http://localhost:3000"

    # SMTP email settings (all optional; if smtp_host is unset, emails are logged instead)
    smtp_host: Optional[str] = None
    smtp_port: int = 587
    smtp_username: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_from_email: str = "noreply@nagelfluh.example.com"

    # Container Registry Configuration
    registry_url: str = "registry:5000"  # in-cluster pull URL; overridden by k8s ConfigMap in prod
    registry_auth: Optional[str] = None  # Auth credentials (base64 username:password or empty for no auth)

    # Plugin frontend build configuration
    # Server-local directory the admin populates ahead of time with plugin npm packages
    # (`.tgz` tarballs from `npm pack`, or unpacked source dirs). The build resolves
    # name@version against this directory — it NEVER fetches plugin source from the public registry.
    plugin_npm_source_dir: str = "/var/lib/nagelfluh/plugin-npm-source"
    # Optional npm registry used only for the build toolchain / non-shared deps (NOT plugin source).
    plugin_npm_registry: Optional[str] = None
    # How the build pod mounts the server-local npm source dir into its filesystem. The build pod
    # needs the admin-populated source dir present at `plugin_npm_source_dir` to resolve the plugin.
    # One of: "" / "none" (no volume — local/dev only), "pvc" (PersistentVolumeClaim), or "hostpath".
    plugin_npm_source_volume_type: str = ""
    # PVC name (when volume_type == "pvc") or host path (when volume_type == "hostpath").
    plugin_npm_source_volume_source: Optional[str] = None

    class Config:
        env_file = "config.env"
        env_file_encoding = "utf-8"
        extra = "ignore"

    @field_validator('jwt_secret_key', mode='before')
    @classmethod
    def set_jwt_secret(cls, v):
        if v is None:
            logger.warning(
                "JWT_SECRET_KEY not set in environment. Using generated secret. "
                "Sessions will not persist across server restarts. "
                "Set JWT_SECRET_KEY in config.env for production."
            )
            return secrets.token_urlsafe(32)
        return v


settings = Settings()
