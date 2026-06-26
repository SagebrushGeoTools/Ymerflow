from decimal import Decimal
from datetime import datetime


class InsufficientFundsError(Exception):
    pass


def _calculate_max_cost(process_version):
    cpu_cores = float(str(process_version.resource_requests.get('cpu', '1000m')).rstrip('m')) / 1000
    memory_gb = float(str(process_version.resource_requests.get('memory', '2Gi')).rstrip('Gi'))
    deadline = process_version.deadline_seconds or 3600
    cpu_cost = cpu_cores * deadline * 0.0001
    memory_cost = memory_gb * deadline * 0.00002
    return Decimal(str(round(cpu_cost + memory_cost, 4)))


def _calculate_actual_cost(process_version, runtime_seconds):
    cpu_cores = float(str(process_version.resource_requests.get('cpu', '1000m')).rstrip('m')) / 1000
    memory_gb = float(str(process_version.resource_requests.get('memory', '2Gi')).rstrip('Gi'))
    cpu_cost = cpu_cores * runtime_seconds * 0.0001
    memory_cost = memory_gb * runtime_seconds * 0.00002
    return Decimal(str(round(cpu_cost + memory_cost, 4)))


def register_models():
    """Import billing models to register them with SQLAlchemy metadata."""
    from billing import models  # noqa


def register_routers(app):
    """Register billing API router with the FastAPI app."""
    return []


def frontend_bundles():
    """Declare frontend bundles shipped as package data."""
    return []


def user_query_options():
    """Return extra selectinload options for billing relations."""
    from sqlalchemy.orm import selectinload
    from backend.models.user import User
    return [
        selectinload(User.billing_balance),
        selectinload(User.billing_transactions),
    ]


def user_to_dict(user):
    """Return extra fields (balance, transactions) to merge into user.to_dict()."""
    result = {}
    if hasattr(user, 'billing_balance') and user.billing_balance is not None:
        result['balance'] = float(user.billing_balance.balance)
    else:
        result['balance'] = 0.0
    if hasattr(user, 'billing_transactions') and user.billing_transactions:
        result['transactions'] = [t.to_dict() for t in user.billing_transactions]
    else:
        result['transactions'] = []
    return result


async def job_pre_run(db, user, process, process_version):
    """Balance check + HOLD transaction; raises InsufficientFundsError to abort."""
    from billing.models import UserBalance, UserTransaction, TransactionType
    from billing.config import billing_settings
    from sqlalchemy import select

    stmt = select(UserBalance).where(UserBalance.user_id == user.id)
    result = await db.execute(stmt)
    balance_row = result.scalar_one_or_none()
    if balance_row is None:
        balance_row = UserBalance(user_id=user.id, balance=Decimal('0'))
        db.add(balance_row)
        await db.flush()

    max_cost = _calculate_max_cost(process_version)
    submission_cost = Decimal(str(billing_settings.process_cost))

    if balance_row.balance < submission_cost:
        raise InsufficientFundsError(
            f"Insufficient balance for submission fee. Required: ${submission_cost}, "
            f"Available: ${balance_row.balance}"
        )

    if balance_row.balance - submission_cost < max_cost:
        raise InsufficientFundsError(
            f"Insufficient balance. Required: ${max_cost + submission_cost}, "
            f"Available: ${balance_row.balance}"
        )

    balance_row.balance -= submission_cost

    hold_tx = UserTransaction(
        user_id=user.id,
        timestamp=datetime.utcnow(),
        type=TransactionType.hold,
        description=f"Hold for process {process.name} v{process_version.version}",
        amount=max_cost,
        process_id=process.id,
        process_version=process_version.version,
        process_name=process.name,
    )
    db.add(hold_tx)
    await db.commit()
    return []


async def job_completed(db, process, process_version, runtime_seconds, status):
    """RELEASE + DEBIT transactions on job completion."""
    from billing.models import UserBalance, UserTransaction, TransactionType
    from sqlalchemy import select

    stmt = select(UserTransaction).where(
        UserTransaction.process_id == process_version.process_id,
        UserTransaction.process_version == process_version.version,
        UserTransaction.type == TransactionType.hold,
    )
    result = await db.execute(stmt)
    hold_tx = result.scalar_one_or_none()
    if hold_tx is None:
        return []

    user_id = hold_tx.user_id
    actual_cost = _calculate_actual_cost(process_version, runtime_seconds)

    release_tx = UserTransaction(
        user_id=user_id,
        timestamp=datetime.utcnow(),
        type=TransactionType.release,
        description=f"Release hold for process {process.name} v{process_version.version}",
        amount=hold_tx.amount,
        process_id=process.id,
        process_version=process_version.version,
        process_name=process.name,
    )
    db.add(release_tx)

    debit_tx = UserTransaction(
        user_id=user_id,
        timestamp=datetime.utcnow(),
        type=TransactionType.debit,
        description=f"Charge for process {process.name} v{process_version.version}",
        amount=actual_cost,
        process_id=process.id,
        process_version=process_version.version,
        process_name=process.name,
    )
    db.add(debit_tx)

    stmt = select(UserBalance).where(UserBalance.user_id == user_id)
    result = await db.execute(stmt)
    balance_row = result.scalar_one_or_none()
    if balance_row:
        balance_row.balance -= actual_cost

    return []


async def user_created(db, user):
    """Create UserBalance + CREDIT transaction on signup."""
    from billing.models import UserBalance, UserTransaction, TransactionType
    from billing.config import billing_settings

    balance = UserBalance(
        user_id=user.id,
        balance=Decimal(str(billing_settings.initial_user_balance)),
    )
    db.add(balance)

    credit_tx = UserTransaction(
        user_id=user.id,
        timestamp=datetime.utcnow(),
        type=TransactionType.credit,
        description="Welcome bonus",
        amount=Decimal(str(billing_settings.initial_user_balance)),
    )
    db.add(credit_tx)
    return []
