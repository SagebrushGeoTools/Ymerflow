from fastapi import Depends, HTTPException

from backend.services.auth_service import get_current_user, AuthContext


async def require_admin(auth: AuthContext = Depends(get_current_user)) -> AuthContext:
    if not auth.user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return auth
