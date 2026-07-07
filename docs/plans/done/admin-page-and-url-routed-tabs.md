# Admin Page & URL-Routed Account/Admin Tabs

## Goal

1. Add a new top-level **Admin** page, reachable from a new **Admin** item in the username
   dropdown menu (shown only to admin users, next to **Account**).
2. The Admin page is a sibling top-level page to Account — same shape: a set of built-in tabs
   plus tabs contributed by plugins through a hook, exactly like the Account page.
3. Move the tabs currently rendered under **Account → Admin** to be top-level tabs of the new
   Admin page. The nested Admin tab inside Account is removed.
4. Both the Account page and the Admin page store and load the **currently active tab in the
   URL** (via react-router), instead of relying on react-bootstrap's uncontrolled
   `defaultActiveKey`. Reloading or sharing a link lands on the correct tab.

This plan lives entirely in the host repo and does **not** reference the billing plugin. The
`admin_tabs` hook it consumes is a generic plugin extension point; whether any plugin registers
into it is irrelevant to this plan.

---

## Background & Current State

### Menu

`frontend/src/UserMenu.jsx` registers menu items into the generic `MenuContext`:

```jsx
useRegisterMenu([menuName, 'Account'], handleAccountClick, 1);   // navigate('/account')
useRegisterMenu([menuName, 'Log Out'], handleLogout, 2);
```

`Account` is a plain menu entry whose action is `navigate('/account')`.

### Routes

`frontend/src/App.jsx` hardcodes the Account route:

```jsx
<Route path="/account" element={
  <div className="d-flex flex-column h-100">
    <MessageDisplay />
    <MenuBarWithComponents />
    <div className="flex-grow-1 overflow-auto"><AccountPage /></div>
  </div>
} />
```

react-router-dom v7 is mounted at the root (`frontend/src/index.jsx` → `<BrowserRouter>`).

### AccountPage tabs (`frontend/src/AccountPage.jsx`)

- Uncontrolled `<Tab.Container defaultActiveKey="profile">` — no state, no URL, always opens on
  `profile`.
- Built-in tabs: `profile`, `api` (API Keys & MCP).
- Plugin tabs: `const extraTabs = useMemo(() => hooks.run.account_tabs(), [])`.
- Admin tab (gated `{user.is_admin && …}`), eventKey `admin`, renders `<AdminTab currentUser={user} />`.

### AdminTab (nested, inside AccountPage.jsx)

```jsx
function AdminTab({ currentUser }) {
  const adminTabs = useMemo(() => hooks.run.admin_tabs(), []);
  if (adminTabs.length === 0) return <UsersAdminPanel currentUser={currentUser} />;
  return (
    <Tab.Container defaultActiveKey="users">
      … <Nav.Link eventKey="users">Users</Nav.Link> + adminTabs …
      <Tab.Pane eventKey="users"><UsersAdminPanel currentUser={currentUser} /></Tab.Pane>
      … adminTabs panes rendering <Component /> …
    </Tab.Container>
  );
}
```

So the Admin area today is: built-in `users` tab (`UsersAdminPanel`) + `admin_tabs` hook tabs,
rendered nested inside the Account page and gated on `user.is_admin`.

### Plugin hook mechanism (`frontend/src/plugins/hooks.jsx`)

Generic registry. `hooks.run.<name>()` calls every registered fn for `<name>` and flattens the
results. `account_tabs` and `admin_tabs` are conventional hook names returning
`[{ key, title, Component }, …]`. Nothing changes here.

---

## Design Decisions

### Decision 1: URL scheme for the active tab — **path segment** (chosen)

The active tab is a path segment: `/account/:tab?` and `/admin/:tab?`.

| URL | Result |
|---|---|
| `/account` | redirect to `/account/profile` (default tab) |
| `/account/contract` | Account page, Contract tab active |
| `/admin` | redirect to `/admin/users` (default tab) |
| `/admin/plans` | Admin page, Plans tab active |

**Rationale:** clean, shareable, RESTful; a stable deep link (`/account/contract`) that plugins
(e.g. a payment return URL) can target by path. Query-param encoding was rejected to keep the tab
identity in the path and avoid colliding with existing query markers.

An unknown `:tab` value falls back to the default tab (redirect to the default path).

### Decision 2: Shared `TabbedPage` component — **extract one** (chosen)

Account and Admin are structurally identical: built-in tabs + hook-contributed tabs + URL-synced
active tab. Extract a single reusable component so the URL-sync logic lives in one place.

**Rejected:** duplicating `Tab.Container` + URL sync in each page.

### Decision 3: `admin_tabs` hook name — **keep it** (chosen)

The main repo relocates the *consumer* of `admin_tabs` from the nested `AdminTab` inside Account to
the new top-level Admin page. The hook name and its `[{ key, title, Component }]` contract are
unchanged, staying symmetric with `account_tabs`. Any plugin registering into `admin_tabs` needs no
change — its tabs simply render on the new page.

### Decision 4: Non-admin access to `/admin` — **redirect to `/app`** (chosen)

A non-admin who navigates to `/admin` (typed URL or stale link) is silently redirected to `/app`
via `<Navigate to="/app" replace />`, consistent with the existing catch-all `*` route. The Admin
menu item is not rendered for non-admins in the first place; this guard covers direct navigation.

---

## Component Design

### New: `frontend/src/TabbedPage.jsx`

A reusable tabbed page whose active tab is bound to a URL path segment.

```jsx
// Props:
//   title      – heading shown above the tabs (e.g. "Account", "Admin")
//   basePath   – route base without the tab segment (e.g. "/account", "/admin")
//   builtinTabs – [{ key, title, render: () => JSX }]   ordered, first is the default
//   hookName   – plugin hook name to pull extra tabs from (e.g. "account_tabs")
//   tabProps   – optional object spread as props into each hook tab's <Component />
export default function TabbedPage({ title, basePath, builtinTabs, hookName, tabProps }) { … }
```

Behavior:

- `const { tab } = useParams();` — the active tab key comes from the URL.
- `const extraTabs = useMemo(() => hooks.run[hookName](), [hookName]);`
- `const allKeys = [...builtinTabs.map(t => t.key), ...extraTabs.map(t => t.key)];`
- `const defaultKey = builtinTabs[0].key;`
- If `tab` is missing or not in `allKeys`, render `<Navigate to={`${basePath}/${defaultKey}`} replace />`.
- Controlled container:
  `<Tab.Container activeKey={tab} onSelect={k => navigate(`${basePath}/${k}`)}>`.
  `onSelect` uses `navigate` (push) so tab switches are back-button navigable.
- Renders built-in tab nav/panes from `builtinTabs`, then hook tab nav/panes, passing `tabProps`
  into each hook `<Component {...tabProps} />`.

This is the single place that maps URL ⇄ active tab; both pages reuse it.

### `frontend/src/AccountPage.jsx` (refactor)

- Remove the local `Tab.Container defaultActiveKey="profile"` scaffolding and the nested Admin tab
  (the `{user.is_admin && …}` nav item + pane and the `AdminTab` invocation).
- Keep all the profile/api/preferences/keys logic; expose the two built-in tabs as `builtinTabs`
  entries whose `render` returns the existing JSX bodies (`profile`, `api`).
- Render via `<TabbedPage title="Account" basePath="/account" hookName="account_tabs"
  builtinTabs={[profile, api]} tabProps={{ accountData, onTransactionClick: handleTransactionClick }} />`.
- `AdminTab` and `UsersAdminPanel` **move out** of AccountPage into the new AdminPage module
  (see below). `UsersAdminPanel` is the only piece AdminPage needs; the `AdminTab` wrapper is no
  longer needed because `TabbedPage` provides the tab shell.

### New: `frontend/src/AdminPage.jsx`

- Contains `UsersAdminPanel` (moved from AccountPage.jsx, unchanged) as the built-in `users` tab.
- Renders `<TabbedPage title="Admin" basePath="/admin" hookName="admin_tabs"
  builtinTabs={[users]} />`. Hook tabs render `<Component />` with no extra props (matching the
  current `admin_tabs` render, which passes none).
- The default (first) built-in tab is `users`.

### `frontend/src/UserMenu.jsx`

Add an Admin menu entry next to Account, gated on `user.is_admin`:

```jsx
const handleAdminClick = () => navigate('/admin');
useRegisterMenu([menuName, 'Account'], handleAccountClick, 1);
if (user?.is_admin) {
  useRegisterMenu([menuName, 'Admin'], handleAdminClick, 2);   // between Account and Log Out
}
useRegisterMenu([menuName, 'Log Out'], handleLogout, 3);
```

> Hooks-in-conditionals caveat: `useRegisterMenu` must be called unconditionally to respect the
> Rules of Hooks. Implementation registers Admin every render but the underlying
> `useRegisterMenuComponent`/registry entry is only *contributed* when `user?.is_admin` is true
> (e.g. pass a `visible`/enabled flag, or register a no-op when not admin). Final mechanism to be
> chosen against how `MenuContext` handles conditional/ordered entries during implementation; the
> requirement is: Admin item appears only for admins, ordered between Account and Log Out.

### `frontend/src/App.jsx` (routes)

Replace the single `/account` route and add the `/admin` route, both with an optional tab segment:

```jsx
<Route path="/account" element={<AccountChrome />}>            {/* redirects to /account/profile */}
  <Route path=":tab" element={<AccountChrome />} />
</Route>
```

Concretely, the simplest form given react-router v7 is a param route rendering the same chrome:

```jsx
<Route path="/account/:tab?" element={
  <div className="d-flex flex-column h-100">
    <MessageDisplay /><MenuBarWithComponents />
    <div className="flex-grow-1 overflow-auto"><AccountPage /></div>
  </div>
} />
<Route path="/admin/:tab?" element={
  <RequireAdmin>
    <div className="d-flex flex-column h-100">
      <MessageDisplay /><MenuBarWithComponents />
      <div className="flex-grow-1 overflow-auto"><AdminPage /></div>
    </div>
  </RequireAdmin>
} />
```

- `RequireAdmin` renders `<Navigate to="/app" replace />` when `!user.is_admin`, else its children.
  (Small wrapper reading `AuthContext`.)
- The chrome (`MessageDisplay` + `MenuBarWithComponents` + scroll container) is factored so the two
  routes don't duplicate it — a tiny local `PageChrome` wrapper is acceptable.
- If react-router v7's optional-segment syntax (`:tab?`) is awkward, use the nested-route form
  above (index route redirects to the default tab). Either is fine; pick during implementation.

---

## Migration / Compatibility

- No backend changes.
- No database changes.
- No hook contract changes (`account_tabs`, `admin_tabs` unchanged).
- **Old links:** bare `/account` continues to work (redirects to `/account/profile`). Anyone with a
  bookmark to `/account` is unaffected. There was previously no way to deep-link a tab, so no old
  deep links break.
- **Plugins** registering `admin_tabs` need no change; their tabs move from Account→Admin nested to
  the top-level Admin page automatically.

---

## Implementation Steps

1. Add `frontend/src/TabbedPage.jsx` (shared component, URL-synced controlled `Tab.Container`).
2. Create `frontend/src/AdminPage.jsx`; move `UsersAdminPanel` there (from AccountPage.jsx) as the
   `users` built-in tab; render `TabbedPage` with `hookName="admin_tabs"`.
3. Refactor `frontend/src/AccountPage.jsx` to render `TabbedPage` with `hookName="account_tabs"`,
   built-in `profile` + `api` tabs, and `tabProps={{ accountData, onTransactionClick }}`. Delete the
   nested `AdminTab` and the `admin`-gated nav item/pane. Remove now-unused imports.
4. Add the `/admin/:tab?` route and convert `/account` to `/account/:tab?` in `frontend/src/App.jsx`;
   add the `RequireAdmin` guard (redirect non-admins to `/app`) and factor the shared page chrome.
5. Add the admin-only **Admin** menu item in `frontend/src/UserMenu.jsx`, ordered between Account
   and Log Out.
6. Manual verification (see below).

---

## Verification

- As an admin: username menu shows **Account** and **Admin**. Clicking Admin → `/admin/users`.
- Switching tabs on either page updates the URL (`/account/contract`, `/admin/plans`); browser
  back/forward navigates tab history.
- Reloading on `/account/contract` or `/admin/plans` lands on that exact tab.
- Bare `/account` → `/account/profile`; bare `/admin` → `/admin/users`.
- Unknown tab (`/account/nonsense`) → redirect to default tab.
- As a non-admin: no Admin menu item; navigating to `/admin` → redirect to `/app`.
- Account page no longer shows an Admin tab; its former sub-tabs appear on the Admin page.

---

## Open Questions

- [ ] Exact `MenuContext` mechanism for conditionally showing the admin-only item while obeying the
      Rules of Hooks (register-always vs. register-when-admin) — resolve against `UserMenu.jsx` /
      `MenuContext` during implementation. Recommendation: register unconditionally, contribute the
      entry only when `user?.is_admin`.
- [ ] Optional-segment route syntax (`/account/:tab?`) vs. nested index-redirect route — pick
      whichever reads cleanest in react-router v7. Recommendation: nested route with an index
      redirect to the default tab.
