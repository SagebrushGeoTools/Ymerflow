"""Seed initial admin user from config

Revision ID: e2f3a4b5c6d7
Revises: e68914430f35
Create Date: 2026-06-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import table, column
from datetime import datetime


revision = 'e2f3a4b5c6d7'
down_revision = 'e68914430f35'
branch_labels = None
depends_on = None


def upgrade() -> None:
    from backend.config import settings
    if not settings.admin_username:
        return

    bind = op.get_bind()
    users = table(
        'users',
        column('username', sa.String),
        column('email', sa.String),
        column('password_hash', sa.String),
        column('is_admin', sa.Boolean),
        column('preferences', sa.JSON),
        column('created_at', sa.DateTime),
    )

    result = bind.execute(
        sa.text('SELECT id FROM users WHERE username = :u').bindparams(
            u=settings.admin_username.lower()
        )
    )
    existing = result.fetchone()

    if existing:
        bind.execute(
            sa.text('UPDATE users SET is_admin = :v WHERE username = :u').bindparams(
                v=True, u=settings.admin_username.lower()
            )
        )
    else:
        from passlib.context import CryptContext
        pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
        password_hash = pwd_context.hash(settings.admin_password or "")

        bind.execute(
            users.insert().values(
                username=settings.admin_username.lower(),
                email=None,
                password_hash=password_hash,
                is_admin=True,
                preferences={},
                created_at=datetime.utcnow(),
            )
        )


def downgrade() -> None:
    pass  # cannot undo seeding
