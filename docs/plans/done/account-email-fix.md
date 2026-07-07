# Fix Account Email Storage — Plan

## Goal

Bugfix, not a UI change. The Account page's "Email" field currently reads/writes
`preferences.email` (an arbitrary, untyped key inside the `preferences` JSON blob),
which is never read anywhere on the backend. Billing (Dodo customer creation) and
project invites both key off the real `users.email` column instead, which has no
UI to set or update after signup. Result: a user can "set their email" in
Preferences and it silently has no effect on billing/invites.

Fix: the Email field on the Account page keeps its exact current appearance and
position (Preferences card, Edit/Save flow) — only its storage target changes,
from `preferences.email` to the real `users.email` column.

No backfill: any value a user already has sitting in `preferences.email` is not
migrated. Existing users just re-enter their email once through the fixed field.

---

## What Already Exists

- `users.email` — `String(255), unique=True, nullable=True, index=True`
  (`backend/models/user.py`). Currently only ever set at signup
  (`backend/routers/auth.py: POST /auth/signup`); no update path after that.
- `PUT /auth/account/preferences` — overwrites the whole `preferences` JSON blob
  wholesale. Frontend currently stores `email` and `email_notifications` under it.
- `frontend/src/AccountPage.jsx` — Preferences card with an Edit/Save form
  containing an Email input and an "Email notifications" checkbox, both bound to
  local `preferences` state.

## Out of Scope

- `preferences.email_notifications` — untouched, stays in `preferences` exactly
  as today.
- No visual/layout changes to the Account page.
- No backfill migration.

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Update path | New endpoint `PUT /auth/account/email`, body `{"email": string \| null}` | Keeps the real, constrained column's write path separate from the arbitrary `preferences` blob endpoint, matching why the column exists (indexed, unique) |
| Validation | Reject empty string as `null` (unset); otherwise store as given, no format/casing normalization | Matches existing signup behavior, which also stores the raw string with no normalization |
| Uniqueness conflict | Catch the DB unique-constraint violation on commit, roll back, return `400` with a clear detail message | `users.email` is `unique=True`; two users must not collide |
| Frontend save | `handleSavePreferences` calls the new email mutation and the existing preferences mutation (now carrying only `email_notifications`) | Same Save button, same form, same UX — just split into two backend calls |
| Frontend read | Email field/display reads `accountData.email` (top-level) instead of `accountData.preferences.email` | Reflects the real source of truth |
| `preferences.email` key | Stop writing it going forward | Storing the same value in two disconnected places is exactly the bug being fixed |

---

## Backend Changes

### `backend/routers/auth.py` — new endpoint

```python
@router.put("/account/email")
async def update_email(
    body: Dict[str, Optional[str]],
    auth: AuthContext = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Update the current user's email (the real users.email column, not preferences)."""
    email = body.get("email") or None
    auth.user.email = email
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="This email is already associated with another account.")

    from backend.hooks import hooks
    extra_opts = hooks.run.user_query_options()
    stmt = select(User).options(*extra_opts).where(User.id == auth.user.id)
    result = await db.execute(stmt)
    user = result.scalar_one()
    return user.to_dict()
```

Mirrors the existing `update_preferences` handler shape immediately above it.
Requires importing `IntegrityError` from `sqlalchemy.exc`.

---

## Frontend Changes

### `frontend/src/datamodel/api.js`

```js
export async function updateUserEmail(email) {
  const response = await apiClient.put('/auth/account/email', { email });
  return response.data;
}
```

### `frontend/src/datamodel/useAuthQueries.js`

```js
export function useUpdateEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateUserEmail,
    onSuccess: () => {
      queryClient.invalidateQueries(['userAccount']);
    }
  });
}
```

Import `updateUserEmail` alongside the other `api.js` imports at the top of the file.

### `frontend/src/AccountPage.jsx`

- Add `const updateEmailMutation = useUpdateEmail();` alongside the existing
  `updatePrefsMutation`.
- Add local `const [email, setEmail] = useState('');`, initialized from
  `accountData.email` in the same `useEffect` that currently seeds `preferences`
  from `accountData.preferences` (drop `email` from that seed instead).
- Email `<Form.Control>` binds to `email` / `setEmail` instead of
  `preferences.email` / merging into `preferences`.
- Read-only display line uses `{email || 'Not set'}` instead of
  `{preferences.email || 'Not set'}`.
- `handleSavePreferences` (rename to `handleSaveProfile` since it now does more
  than preferences) becomes:

```js
const handleSaveProfile = async () => {
  try {
    const updatedFromEmail = await updateEmailMutation.mutateAsync(email || null);
    const updated = await updatePrefsMutation.mutateAsync(preferences); // preferences no longer contains `email`
    updateUser(updated);
    setEmail(updatedFromEmail.email || '');
    setIsEditing(false);
  } catch (err) {
    alert(err?.response?.data?.detail || 'Failed to save profile');
  }
};
```

- Anywhere else in `AccountPage.jsx` that already reads `user.email` (e.g. the
  admin users table) is untouched — it already reads the correct column.

---

## Implementation Steps

1. Add `PUT /auth/account/email` to `backend/routers/auth.py` (import `IntegrityError`).
2. Add `updateUserEmail` to `frontend/src/datamodel/api.js`.
3. Add `useUpdateEmail` to `frontend/src/datamodel/useAuthQueries.js`.
4. Update `frontend/src/AccountPage.jsx`: new `email` state, rewire the Email
   field's binding, rewire the read-only display, update the save handler.
5. Manually verify: set an email via the Account page, confirm `users.email` is
   populated in the DB and a paid-plan billing signup no longer fails on the
   missing-email check.
