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

    # File Storage
    data_base_path: str = "file://./data_storage"

    # Authentication
    jwt_secret_key: Optional[str] = None
    jwt_algorithm: str = "HS256"
    access_token_expire_days: int = 30

    # Application
    process_cost: float = 0.10
    initial_user_balance: float = 100.0

    # Flyte Integration
    flyte_endpoint: str = "http://localhost:30080"
    backend_url: str = "http://localhost:8000"
    default_process_timeout: int = 7200  # 2 hours in seconds

    # CORS
    cors_origins: List[str] = ["http://localhost:3000"]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

    @field_validator('jwt_secret_key', mode='before')
    @classmethod
    def set_jwt_secret(cls, v):
        if v is None:
            logger.warning(
                "JWT_SECRET_KEY not set in environment. Using generated secret. "
                "Sessions will not persist across server restarts. "
                "Set JWT_SECRET_KEY in .env for production."
            )
            return secrets.token_urlsafe(32)
        return v


settings = Settings()
