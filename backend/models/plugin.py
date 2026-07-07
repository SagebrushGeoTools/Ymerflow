from sqlalchemy import Column, String, Integer, Boolean, DateTime, JSON, ForeignKey, UniqueConstraint, Text
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from backend.database import Base


class Plugin(Base):
    """Stable plugin identity. Code lives in immutable PluginVersion rows."""
    __tablename__ = "plugins"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), unique=True, nullable=False)   # MF remote name
    display_name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    latest_version_id = Column(
        String(36),
        ForeignKey("plugin_versions.id", use_alter=True, name="fk_plugin_latest_version"),
        nullable=True,
    )
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    latest_version = relationship("PluginVersion", foreign_keys=[latest_version_id], post_update=True)
    versions = relationship(
        "PluginVersion",
        back_populates="plugin",
        foreign_keys="PluginVersion.plugin_id",
        cascade="all, delete-orphan",
    )
    user_plugins = relationship("UserPlugin", back_populates="plugin", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "display_name": self.display_name,
            "description": self.description,
            "latest_version_id": self.latest_version_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class PluginVersion(Base):
    """One built version of a plugin — an immutable, content-addressed reference."""
    __tablename__ = "plugin_versions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    plugin_id = Column(String(36), ForeignKey("plugins.id", ondelete="CASCADE"), nullable=False)
    project_id = Column(String(255), ForeignKey("projects.id"), nullable=False)
    process_id = Column(String(255), nullable=False)
    process_version = Column(Integer, nullable=False)
    output_dataset_id = Column(String(255), nullable=False)
    npm_name = Column(String(255), nullable=False)
    npm_version = Column(String(64), nullable=False)
    content_hash = Column(String(64), nullable=False, index=True)
    built_against = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)

    plugin = relationship("Plugin", back_populates="versions", foreign_keys=[plugin_id])

    __table_args__ = (UniqueConstraint("plugin_id", "content_hash"),)

    def to_dict(self):
        return {
            "id": self.id,
            "plugin_id": self.plugin_id,
            "npm_name": self.npm_name,
            "npm_version": self.npm_version,
            "content_hash": self.content_hash,
            "built_against": self.built_against,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class UserPlugin(Base):
    """A user's enabled plugin, pinned to a specific version."""
    __tablename__ = "user_plugins"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    plugin_id = Column(String(36), ForeignKey("plugins.id"), nullable=False)
    plugin_version_id = Column(String(36), ForeignKey("plugin_versions.id"), nullable=False)
    enabled = Column(Boolean, default=True, nullable=False)
    installed_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")
    plugin = relationship("Plugin", back_populates="user_plugins")
    plugin_version = relationship("PluginVersion")

    __table_args__ = (UniqueConstraint("user_id", "plugin_id"),)

    def to_dict(self):
        return {
            "id": self.id,
            "plugin_id": self.plugin_id,
            "plugin_version_id": self.plugin_version_id,
            "enabled": self.enabled,
            "installed_at": self.installed_at.isoformat() if self.installed_at else None,
        }
