from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Dict
from datetime import datetime
from decimal import Decimal
import asyncio

from backend.database import get_db
from backend.models import User, UserTransaction, TransactionType
from backend.services.auth_service import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user
)
from backend.config import settings

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/signup")
async def signup(credentials: Dict[str, str], db: AsyncSession = Depends(get_db)):
    """Sign up with username and password"""
    import logging
    logger = logging.getLogger(__name__)

    logger.info(f"Signup request received: {credentials.keys()}")

    username = credentials.get("username")
    password = credentials.get("password")

    if not username or not password:
        logger.error(f"Missing credentials - username: {bool(username)}, password: {bool(password)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username and password are required"
        )

    try:
        # Check if user already exists (case-insensitive)
        logger.info(f"Checking if user '{username.lower()}' exists...")
        stmt = select(User).where(User.username == username.lower())
        result = await db.execute(stmt)
        existing_user = result.scalar_one_or_none()

        if existing_user:
            logger.warning(f"User '{username.lower()}' already exists")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already exists"
            )

        logger.info(f"Creating new user '{username.lower()}'...")

        # Create new user with hashed password (bcrypt is CPU-bound; run off the event loop)
        password_hash = await asyncio.to_thread(hash_password, password)
        user = User(
            username=username.lower(),
            password_hash=password_hash,
            balance=Decimal(str(settings.initial_user_balance)),
            preferences={}
        )
        db.add(user)
        await db.flush()  # Flush to get user.id

        # Create welcome transaction
        transaction = UserTransaction(
            user_id=user.id,
            timestamp=datetime.utcnow(),
            type=TransactionType.credit,
            description="Welcome bonus",
            amount=Decimal(str(settings.initial_user_balance))
        )
        db.add(transaction)

        await db.commit()

        # Refresh user with relationships eagerly loaded
        stmt = select(User).options(selectinload(User.transactions)).where(User.id == user.id)
        result = await db.execute(stmt)
        user = result.scalar_one()

        # Generate JWT token
        access_token = create_access_token(data={"sub": user.username})

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": user.to_dict()
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Signup error: {type(e).__name__}: {str(e)}", exc_info=True)
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Signup failed: {str(e)}"
        )


@router.post("/login")
async def login(credentials: Dict[str, str], db: AsyncSession = Depends(get_db)):
    """Login with username and password"""
    username = credentials.get("username")
    password = credentials.get("password")

    if not username or not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username and password are required"
        )

    # Look up user (case-insensitive) with transactions eagerly loaded
    stmt = select(User).options(selectinload(User.transactions)).where(User.username == username.lower())
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    # Verify password off the event loop — bcrypt is intentionally CPU-intensive (~200ms)
    if not user or not await asyncio.to_thread(verify_password, password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Generate JWT token
    access_token = create_access_token(data={"sub": user.username})

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user.to_dict()
    }


@router.post("/forgot-password")
async def forgot_password(data: Dict[str, str]):
    """Placeholder for password reset (not implemented yet)"""
    return {
        "message": "Password reset not implemented yet. Please contact support."
    }


@router.get("/account")
async def get_account(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get current user account information"""
    # Refresh user with transactions eagerly loaded
    stmt = select(User).options(selectinload(User.transactions)).where(User.id == current_user.id)
    result = await db.execute(stmt)
    user = result.scalar_one()
    return user.to_dict()


@router.put("/account/preferences")
async def update_preferences(
    preferences: Dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Update user preferences"""
    current_user.preferences = preferences
    await db.commit()

    # Refresh user with transactions eagerly loaded
    stmt = select(User).options(selectinload(User.transactions)).where(User.id == current_user.id)
    result = await db.execute(stmt)
    user = result.scalar_one()

    return user.to_dict()
