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

    class Config:
        env_file = "config.env"
        env_file_encoding = "utf-8"

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
