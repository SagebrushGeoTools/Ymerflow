from sqlalchemy import Column, Integer, String, DateTime, JSON, Numeric, ForeignKey, Enum
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

from backend.database import Base


class TransactionType(str, enum.Enum):
    CREDIT = "credit"
    DEBIT = "debit"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    balance = Column(Numeric(10, 2), default=100.0, nullable=False)
    preferences = Column(JSON, default=dict, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    transactions = relationship("UserTransaction", back_populates="user", cascade="all, delete-orphan")

    def to_dict(self, include_password=False):
        """Convert to API response format"""
        result = {
            "username": self.username,
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
