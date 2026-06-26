from sqlalchemy import Column, Integer, String, DateTime, Numeric, ForeignKey, Enum
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

from backend.database import Base
from backend.models.user import User


class TransactionType(str, enum.Enum):
    credit = "credit"
    debit = "debit"
    hold = "hold"
    release = "release"


class UserBalance(Base):
    __tablename__ = "user_balances"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    balance = Column(Numeric(10, 2), default=0, nullable=False)
    user = relationship("User", back_populates="billing_balance")


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
    user = relationship("User", back_populates="billing_transactions")

    def to_dict(self):
        result = {
            "timestamp": self.timestamp.isoformat(),
            "type": self.type.value,
            "description": self.description,
            "amount": float(self.amount),
        }
        if self.process_id:
            result["process_id"] = self.process_id
        if self.process_version is not None:
            result["process_version"] = self.process_version
        if self.process_name:
            result["process_name"] = self.process_name
        return result


# Patch back-references onto User — runs at import time, before configure_mappers()
User.billing_balance = relationship("UserBalance", uselist=False, cascade="all, delete-orphan")
User.billing_transactions = relationship(
    "UserTransaction", back_populates="user", cascade="all, delete-orphan"
)
