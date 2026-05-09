from sqlalchemy import Column, Integer, String, DateTime, JSON, Numeric, ForeignKey, Enum
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

from backend.database import Base


class TransactionType(str, enum.Enum):
    credit = "credit"
    debit = "debit"
    hold = "hold"  # Reserve funds (upfront based on deadline)
    release = "release"  # Release held funds (on completion)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(255), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=True, index=True)
    password_hash = Column(String(255), nullable=False)
    balance = Column(Numeric(10, 2), default=100.0, nullable=False)
    preferences = Column(JSON, default=dict, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    transactions = relationship("UserTransaction", back_populates="user", cascade="all, delete-orphan")
    project_memberships = relationship("ProjectMember", back_populates="user", cascade="all, delete-orphan")

    async def get_held_amount(self, db):
        """Calculate total currently held funds (HOLD - RELEASE)"""
        from decimal import Decimal
        from sqlalchemy import select, func

        # Sum all HOLD transactions
        hold_stmt = select(func.coalesce(func.sum(UserTransaction.amount), 0)).where(
            UserTransaction.user_id == self.id,
            UserTransaction.type == TransactionType.hold
        )
        hold_result = await db.execute(hold_stmt)
        total_hold = hold_result.scalar()

        # Sum all RELEASE transactions
        release_stmt = select(func.coalesce(func.sum(UserTransaction.amount), 0)).where(
            UserTransaction.user_id == self.id,
            UserTransaction.type == TransactionType.release
        )
        release_result = await db.execute(release_stmt)
        total_release = release_result.scalar()

        return Decimal(str(total_hold)) - Decimal(str(total_release))

    async def get_available_balance(self, db):
        """Get balance minus held funds"""
        held = await self.get_held_amount(db)
        return self.balance - held

    def to_dict(self, include_password=False):
        """Convert to API response format"""
        result = {
            "username": self.username,
            "email": self.email,
            "balance": float(self.balance),
            "preferences": self.preferences,
            "transactions": [t.to_dict() for t in self.transactions]
        }
        if include_password:
            result["password"] = self.password_hash  # For internal use only
        return result


class UserTransaction(Base):
    __tablename__ = "user_transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    type = Column(Enum(TransactionType), nullable=False)
    description = Column(String(500), nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    process_id = Column(String(255), ForeignKey("processes.id", ondelete="SET NULL"), nullable=True)
    process_version = Column(Integer, nullable=True)
    process_name = Column(String(255), nullable=True)

    # Relationships
    user = relationship("User", back_populates="transactions")

    def to_dict(self):
        """Convert to API response format"""
        result = {
            "timestamp": self.timestamp.isoformat(),
            "type": self.type.value,
            "description": self.description,
            "amount": float(self.amount)
        }
        if self.process_id:
            result["process_id"] = self.process_id
        if self.process_version is not None:
            result["process_version"] = self.process_version
        if self.process_name:
            result["process_name"] = self.process_name
        return result
