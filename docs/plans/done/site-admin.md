# Site Admin — Plan

## Goal

Add a concept of a "site admin" user. The first admin is bootstrapped from `config.env`. Admins
can grant or revoke admin status for other users via a dedicated tab in the Account page.

---

## What Already Exists

- `users.is_admin` column was added in migration `c2d3e4f5a6b7` and is already on the `User`
  model and in `User.to_dict()`.
- No endpoints or UI use it yet.

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Admin bootstrap | Config-driven migration | Simple, no chicken-and-egg problem; matches how existing seed migrations work |
| Admin username config key | `ADMIN_USERNAME` | Consistent with existing `ADMIN_PASSWORD` comment in config.env.example |
| Admin password config key | `ADMIN_PASSWORD` | Already appears as a comment in config.env.example (currently used only for pgAdmin) |
| Migration behaviour | Upsert: create user if absent, set `is_admin=True` and update password hash | Idempotent; lets the admin rotate their password by changing config and re-running migrations |
| If `ADMIN_USERNAME` is unset | Skip silently | Allows dev environments with no admin |
| Endpoint placement | New section in `backend/routers/auth.py` (or a new `admin.py` router) | Auth context already in auth.py; a separate file keeps it clean |
| Prevent self-demotion | Backend enforces: cannot revoke own `is_admin` | Avoids lockout |
| Frontend visibility | Admin tab only shown when `user.is_admin` is true in AuthContext | No information leak to non-admins |

---

## Backend Changes

### 1. `backend/config.py`

Add two settings:

```python
admin_username: Optional[str] = None   # ADMIN_USERNAME in config.env
admin_password: Optional[str] = None   # ADMIN_PASSWORD in config.env
```

### 2. New migration `e2f3a4b5c6d7_seed_initial_admin.py`

- `down_revision = 'd3e4f5a6b7c8'`
- `upgrade()`:
  - If `settings.admin_username` is falsy → return immediately
  - If a user with that username **already exists**: set `is_admin=True` only — **do not touch the password**
  - If no such user exists: create one with `is_admin=True` and the hashed `settings.admin_password`
- `downgrade()`: no-op (cannot undo seeding)

> **Note**: The password is set exactly once — when the user is first created by the migration.
> After that the admin manages their password normally and config.env has no effect on it.

### 3. `backend/routers/auth.py` — new admin endpoints

Add a `require_admin` dependency:

```python
async def require_admin(auth: AuthContext = Depends(get_current_user)):
    if not auth.user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return auth
```

Add endpoints:

```
GET  /auth/admin/users
     → list all users [{username, email, is_admin}], sorted by username
     → requires admin

PUT  /auth/admin/users/{username}/admin
     body: {"is_admin": true | false}
     → sets is_admin on the target user
     → 400 if trying to modify own is_admin (prevent self-lockout)
     → 404 if user not found
     → requires admin
```

---

## Frontend Changes

### 4. `frontend/src/datamodel/api.js`

Add:

```js
export async function listAdminUsers() {
  const response = await apiClient.get('/auth/admin/users');
  return response.data;
}

export async function setUserAdmin(username, isAdmin) {
  const response = await apiClient.put(`/auth/admin/users/${username}/admin`, { is_admin: isAdmin });
  return response.data;
}
```

### 5. `frontend/src/datamodel/useAuthQueries.js`

Add:

```js
export function useAdminUsers() {
  return useQuery({
    queryKey: ['adminUsers'],
    queryFn: listAdminUsers,
  });
}

export function useSetUserAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ username, isAdmin }) => setUserAdmin(username, isAdmin),
    onSuccess: () => queryClient.invalidateQueries(['adminUsers']),
  });
}
```

### 6. `frontend/src/AccountPage.jsx`

- Add an `"admin"` tab to the `<Nav>`, rendered only when `user.is_admin`:

```jsx
{user.is_admin && (
  <Nav.Item>
    <Nav.Link eventKey="admin">Admin</Nav.Link>
  </Nav.Item>
)}
```

- Add a `<Tab.Pane eventKey="admin">` with an `AdminTab` inner component that:
  - Calls `useAdminUsers()` to load all users
  - Renders a table: Username | Email | Admin? | Actions
  - Each row has a "Make admin" or "Revoke admin" button (disabled for current user)
  - Uses `useSetUserAdmin()` mutation on button click

---

## config.env.example Update

Add a section:

```
# ── Site admin bootstrap ──────────────────────────────────────────────────────
# On first startup, if ADMIN_USERNAME is set, that user is created with ADMIN_PASSWORD
# and granted admin status. If the user already exists, only is_admin=True is set —
# the password is never overwritten. Safe to leave set after initial bootstrap.
# ADMIN_USERNAME=admin
# ADMIN_PASSWORD=changeme
```

---

## Implementation Steps

1. Add `admin_username` / `admin_password` to `backend/config.py`
2. Add the config.env.example documentation block
3. Write migration `e2f3a4b5c6d7_seed_initial_admin.py`
4. Add `require_admin` dependency and admin endpoints to `backend/routers/auth.py`
5. Add `listAdminUsers` / `setUserAdmin` to `frontend/src/datamodel/api.js`
6. Add `useAdminUsers` / `useSetUserAdmin` hooks to `frontend/src/datamodel/useAuthQueries.js`
7. Add Admin tab to `frontend/src/AccountPage.jsx`
