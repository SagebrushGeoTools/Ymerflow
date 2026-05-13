# Nagelfluh Development Plan

This document outlines planned features and tasks for the Nagelfluh geophysics data processing application. Each section provides enough context to serve as a starting point for an implementation session.

---

## ~~3. 3D Gridding Process~~  ✅ DONE

**Goal**: Convert 2.5D flightline resistivity "curtains" into full 3D resistivity volume grids.

**Overview**:
Multiple parallel or intersecting flightlines each have 2D resistivity cross-sections. Gridding interpolates between curtains to create a regular 3D (X, Y, Z) resistivity volume.

**Input**:
- Multiple resistivity model datasets (from inversion or model simulator)
- Each curtain has: X (distance along flightline), Z (depth), resistivity values
- Each curtain has geographic position/path

**Output**:
- 3D regular grid with resistivity values
- Format TBD (msgpack? NetCDF? VTK?)

**Key questions to resolve**:
- **Interpolation method**: Between flightlines (perpendicular direction)
  - Options: kriging, IDW, natural neighbor, linear interpolation
  - Consider computational cost vs. accuracy
- **Grid specification**:
  - Regular XYZ grid with user-defined resolution?
  - Extent: automatic from input data or user-specified bounding box?
  - Vertical discretization: uniform or match input layer structure?
- **Handling gaps**: Areas far from any flightline
  - Extrapolate? Mark as no-data? Distance threshold?
- **Output format**: Best format for 3D volumes
  - Continue using libaarhusxyz msgpack?
  - NetCDF (standard for gridded geoscience data)?
  - VTK (good for 3D visualization)?

**Implementation notes**:
- New process type in `aem_processes/`
- Schema should allow multiple input datasets (array of dataset URLs)
- Grid parameters in schema: resolution, extent, interpolation method
- Consider performance for large grids

**Future extension**:
- Could also support data gridding (2D maps from scattered XY data)
- Start with 3D resistivity gridding, add 2D later if needed

---

## ~~4. 3D Visualization System~~  ✅ DONE (using gladly)

**Goal**: Comprehensive 3D visualization supporting multiple geometry types with interactive slicing.

**Data types to visualize**:
1. **3D resistivity grids** - Voxel rendering of volumes (from gridding process)
2. **Resistivity curtains** - 2.5D flightline cross-sections positioned in 3D space
3. **Raw AEM data** - dB/dt values mapped to vertical position above ground (with visual scaling)
4. **Satellite imagery on DTM** - Terrain/elevation models with draped imagery texture
5. **Cross-sectioning** - Slice through all objects with arbitrary planes to see internal structure

**Key requirements**:
- Multiple layer types in single 3D view
- Interactive controls: rotation, zoom, pan
- Slicing planes to view cross-sections
- Good performance with large datasets
- Proper coordinate system handling (geographic or projected)

**Technology options to investigate**:

| Option | Pros | Cons | Notes |
|--------|------|------|-------|
| **Cesium** | • Built for 3D geospatial<br>• Handles terrain/imagery natively<br>• 3D globe + flat maps<br>• Mature, feature-rich | • Large bundle size (~2MB+)<br>• Commercial licensing for some features<br>• Learning curve<br>• May be overkill for 2D plots | Could serve both 3D plots AND map underlays (#7) |
| **deck.gl** | • WebGL-first (excellent performance)<br>• Designed for large datasets<br>• Good 2D/3D support<br>• Integrates with map libraries<br>• MIT license | • Less geospatial-specific than Cesium<br>• Terrain/DTM support may need custom work<br>• Volume rendering? | Strong candidate, especially if pursuing WebGL-first approach for all plotting (#6) |
| **three.js + react-three-fiber** | • Maximum flexibility<br>• Lighter weight<br>• Full control over rendering<br>• Good React integration | • More implementation work<br>• Need to handle projections/tiles manually<br>• Build geospatial features from scratch | Best for custom visualizations, more work for standard geospatial features |
| **Hybrid approach** | • Best tool for each job<br>• Flexibility | • Integration complexity<br>• Multiple dependencies<br>• Larger bundle | E.g., Cesium for terrain/imagery, three.js for custom vis |

**Questions to resolve during investigation**:
- Is unified 3D geospatial platform (Cesium) worth the bundle size?
- Can Cesium handle custom visualizations (resistivity curtains, AEM data mapping)?
- Does chosen solution support WebGL-first data loading (typed arrays → GPU buffers)?
- How does slicing work in each framework?
- Performance benchmarks with realistic dataset sizes

**Architecture considerations**:
- New "3DView" widget that can show multiple layers?
- Layer configuration system similar to PlotView's elements?
- How to add/configure layers (UI for selecting datasets, setting parameters)?
- Integration with map widget for 2D/3D switching?

**Overlap with #6 (Alternative plotting frameworks)**:
- Both need high-performance WebGL rendering
- May influence choice of plotting framework overall
- Consider unified approach vs. different tools for 2D and 3D

---

## 5. Plot Cleanup - Line Gaps Bug

**Goal**: Fix bug where lines between consecutive points with different sign or `inuse` flag create visual "holes" in data.

**Problem**:
Current plotting code filters out points (e.g., negative values, `inuse=false`), then draws lines between remaining points. This creates gaps/holes where filtered points were located.

**Root cause**:
Likely in `PlotView.js` or plot element rendering code. The line trace generation doesn't handle discontinuities when points are filtered out.

**Solution approaches**:
1. **Break lines into segments**: Detect when consecutive valid points have filtered points between them, create separate line traces for each continuous segment
2. **Filter differently**: Apply filters at rendering level (set color to transparent) rather than removing points
3. **Null values**: Insert `null` values in traces at discontinuities (Plotly handles this)

**Implementation**:
- Locate line rendering code in `PlotView.js` and plot elements
- Identify where filtering occurs
- Implement proper segmentation or null insertion
- Test with data that has mixed signs and `inuse` flags

**Test cases**:
- Data with alternating positive/negative values
- Data with scattered `inuse=false` flags
- Verify lines are continuous where they should be, broken where they shouldn't

---

## ~~6. Alternative Plotting Frameworks Investigation~~  ✅ DONE (settled on gladly)

**Goal**: Investigate high-performance plotting alternatives that use WebGL-first architecture for large datasets.

**Core problem with Plotly**:
Plotly does extensive data processing/rewriting in JavaScript, which is slow for large datasets. Too much CPU work before GPU can render.

**Ideal architecture**:
- Load typed arrays directly into WebGL buffers (single function call, no JS loops)
- Compile plot parameters/filters into GLSL shaders
- All transformations and rendering happen on GPU
- Minimal JavaScript overhead

**Frameworks to investigate**:

### deck.gl
- **Pros**: WebGL-first, designed for large datasets, good geospatial support, MIT license
- **Cons**: Learning curve, may need custom layers for scientific plots
- **Fit**: Strong candidate, especially combined with #4 (3D plots)

### regl
- **Pros**: Functional WebGL wrapper, very fast, small size
- **Cons**: Lower-level, need to build plotting primitives
- **Fit**: Good foundation for custom plotting layer

### Plotly.js WebGL traces
- **Pros**: Already using Plotly, familiar API
- **Cons**: Still has JS overhead, may not solve core problem
- **Fit**: Quick win if it works, but may not be enough

### Custom WebGL solution
- **Pros**: Total control, exactly what we need
- **Cons**: Most implementation work, maintenance burden
- **Fit**: Worst case fallback

### visx with WebGL layer
- **Pros**: React-friendly, good for 2D charts
- **Cons**: Primarily SVG, WebGL would be custom addition
- **Fit**: Maybe for small/medium datasets, not for large

**Evaluation criteria**:
1. **Performance**: Benchmark with realistic dataset sizes (e.g., 100k-1M points)
2. **API**: How easy to port existing plot elements?
3. **Bundle size**: Impact on app load time
4. **Maintainability**: Community support, documentation, learning curve
5. **Flexibility**: Can it handle scientific plotting needs (multi-axis, units, custom elements)?

**Questions to answer**:
- Replace Plotly entirely, or use WebGL framework only for large datasets?
- Can chosen framework handle both 2D plots and 3D visualization (#4)?
- Integration strategy: gradual migration or big switchover?

**Deliverable**:
- Technical evaluation document with recommendations
- Proof-of-concept with one plot element ported to top candidate
- Performance comparison benchmarks

**Relationship to other tasks**:
- Closely tied to #4 (3D plots) - may want unified solution
- Affects all plotting in the app long-term

---

## 7. Map Underlays and WMS Server  ⚠️ PARTIALLY DONE

**Status**: Frontend supports any XYZ, WMS, WMTS, and COG source. No server-side WMS/TiTiler yet — internal GeoTIFF publishing is still outstanding.

**Goal**: Support external and internal map underlays (basemaps, satellite imagery, geological maps) via WMS/WMTS.

**Requirements**:

### External WMS/WMTS servers
- Configure URLs to external tile services
- Examples: OpenStreetMap, USGS National Map, geological surveys
- UI to add/configure external WMS sources
- Layer selection, opacity control

### Internal WMS server
- **Automatic GeoTIFF publishing**:
  - When GeoTIFF dataset is created/uploaded, automatically register with WMS server
  - Add WMS URL to dataset metadata sent to client
  - Seamless integration with dataset/process system
- **Use cases**:
  - Survey orthophotos
  - Gridded resistivity maps (2D slices from 3D grids)
  - Derived products (e.g., depth to bedrock maps)

**Architecture questions**:

### WMS server implementation
- **Options**:
  - **MapServer**: Fast, C-based, mature, requires Apache/FastCGI
  - **GeoServer**: Java-based, feature-rich, heavier, good admin UI
  - **TiTiler** or **titiler-pgstac**: Python-based, modern, COG-native, FastAPI integration
  - **Custom FastAPI endpoint**: Lightweight, full control, more work
- **Recommendation**: Investigate TiTiler (Python/FastAPI, good fit with existing backend)

### Registration workflow
- How are GeoTIFFs registered with WMS?
  1. **Automatic on dataset creation**: Process that creates GeoTIFF also registers it
  2. **Background watcher**: Monitor dataset storage, auto-register new GeoTIFFs
  3. **Manual registration**: User action to publish dataset as WMS layer
- Should support all three?

### Performance
- Caching strategy (tile caching, COG for efficient access)
- Pre-generate tiles or on-demand?
- Storage location for tiles/COGs

### Frontend integration
- Map widget configuration for base layers
- Layer switcher UI (base layer, overlays, opacity)
- Integration with 3D view (#4) if using Cesium/deck.gl

**Overlap with #4 (3D plots)**:
- If using Cesium: built-in WMS/WMTS support, terrain/imagery handling
- If using deck.gl: can integrate with map libraries (MapLibre, Leaflet) for base layers
- May influence technology choice

**Implementation steps**:
1. Evaluate WMS server options, choose one
2. Set up WMS server (Docker container in dev environment)
3. Implement GeoTIFF registration workflow
4. Update backend to include WMS URLs in dataset metadata
5. Frontend: configure map widget to use WMS layers
6. Add UI for external WMS sources

---

## 8. Manual Processing QC Editor

**Goal**: Interactive editor for manually refining AEM data quality control by toggling in-use flags for soundings and gates.

**Background**:

### AEM data structure
- **Soundings**: Individual measurements taken ~every 75 meters as sensor flies
- **Gates**: Time series samples (TEM decay curve) in each sounding, each with dB/dt value (intensity)
- **Data array**: 2D (soundings × gates) with dB/dt intensity values
- **In-use flags**: 2D boolean array (same shape as data) indicating which measurements are valid

### Workflow
1. Import raw AEM data
2. `processing_process.py` automatically sets initial in-use flags (removes bad/noisy data)
3. **Manual QC** (this feature): User reviews automated flags, manually toggles problematic soundings/gates
4. Flagged data excluded from inversion

**Interface requirements**:

### Tri-state system
For each sounding/gate, user can set one of three states:
- **Set in-use = OFF**: Flag this data as bad (exclude from processing)
- **Set in-use = ON**: Flag this data as good (include in processing)
- **Leave UNCHANGED**: Keep original value from input dataset

### Visualization
- Display 2D heatmap/plot of data with current flags
- X-axis: Sounding index (or distance along flightline)
- Y-axis: Gate index (or time)
- Color: dB/dt intensity (or log scale)
- Overlay: Show current in-use flags (e.g., grayed out or marked)

### Interaction
- **Selection tools**:
  - Click individual cells (sounding/gate)
  - Rectangular selection (drag to select region)
  - Select entire sounding (all gates)
  - Select entire gate (all soundings)
  - Maybe: Polygon/lasso selection
- **Actions**:
  - Toggle selected to OFF/ON/UNCHANGED (keyboard shortcuts or buttons)
  - Undo/redo support

### Integration
- **Work with channel plot**: Integrate with existing plotting system
  - Could be a new widget type ("QCEditor")
  - Or extend PlotView with QC mode
- **Display alongside data plots**: See impact of flagging on downstream analysis

**Technical implementation**:

### Data handling
- Load existing dataset with in-use flags (or default to all `true` if missing)
- Store current state (original flags + user changes)
- Generate diff file on save

### Diff file generation
- Use `libaarhusxyz` diff functionality (see `deps/libaarhusxyz/`)
- Diff file contains only the changes to in-use flags
- Apply diff to original dataset to create modified dataset

### Output
- **New dataset**: Original data + modified in-use flags
- **Or diff dataset**: Diff file that can be applied to original
- Link to original dataset in metadata (provenance)

**UI considerations**:
- Performance with large datasets (thousands of soundings × dozens of gates)
  - Use canvas/WebGL for rendering
  - Consider virtualization for very large datasets
- Visual feedback: clearly show what's flagged, what's been changed by user
- Export/save workflow: automatic save? explicit save button?

**Questions to resolve**:
- New widget type or extend existing?
- Canvas-based or use plotting framework?
- Real-time preview of downstream effects (e.g., show what inversion would see)?

---

## 9. Project Membership, Invites & API Keys

**Goal**: Projects are shared workspaces. Any member can invite others (including people without accounts yet) via email link. Members can leave. Project-scoped API keys give programmatic/MCP access.

**Status**: Tasks 9.1–9.12 **done** (2026-05-09). Tasks 9.13–9.14 remain.

---

### ~~Task 9.1 — Add email to User model~~  ✅ DONE

**File**: `backend/models/user.py`, new Alembic migration

Add a proper `email` column (String, unique, nullable — nullable to avoid breaking existing users):

```python
email = Column(String(255), unique=True, nullable=True, index=True)
```

Update `to_dict()` to include `email`. Update the signup endpoint (`backend/routers/auth.py`) to accept and store an optional `email` field. Update the frontend signup form (`frontend/src/LandingPage.js` or wherever the form lives) to add an email field.

**Why nullable**: Existing users won't have one. When an invite-created user signs up, the form pre-fills their email from the invite link so it gets stored.

---

### ~~Task 9.2 — ProjectMember and ProjectInvite models + migration~~  ✅ DONE

**Files**: `backend/models/project.py` (or new `backend/models/membership.py`), new Alembic migration

```python
class ProjectMember(Base):
    __tablename__ = "project_members"
    project_id = Column(String(255), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    user_id    = Column(Integer,      ForeignKey("users.id",    ondelete="CASCADE"), primary_key=True)
    joined_at  = Column(DateTime, default=datetime.utcnow, nullable=False)

class ProjectInvite(Base):
    __tablename__ = "project_invites"
    id               = Column(String(255), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id       = Column(String(255), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    email            = Column(String(255), nullable=False)
    token            = Column(String(255), unique=True, nullable=False)  # secrets.token_urlsafe(32)
    invited_by_id    = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at       = Column(DateTime, nullable=False)   # created_at + 7 days
    accepted_at      = Column(DateTime, nullable=True)    # null = still pending
```

Add relationships to `Project`:
```python
members = relationship("ProjectMember", back_populates="project", cascade="all, delete-orphan")
invites = relationship("ProjectInvite", back_populates="project", cascade="all, delete-orphan")
```

Add to `backend/models/__init__.py` and export.

**Single migration** covering tasks 9.1 and 9.2 together.

---

### ~~Task 9.3 — Enforce auth and membership on the projects router~~  ✅ DONE

**File**: `backend/routers/projects.py`

1. Add `current_user: User = Depends(get_current_user)` to both `list_projects` and `create_project`.
2. `list_projects`: filter by membership — `JOIN project_members ON project_members.project_id = projects.id WHERE project_members.user_id = current_user.id`.
3. `create_project`: after inserting the project, also insert a `ProjectMember` row for `current_user`.

---

### ~~Task 9.4 — Project membership check dependency~~  ✅ DONE

**File**: `backend/services/auth_service.py` (or new `backend/routers/dependencies.py`)

`get_current_user` returns an `AuthContext` (not a bare `User`) so that API-key auth can carry the key's project scope alongside the user:

```python
@dataclass
class AuthContext:
    user: User
    api_key_project_id: str | None = None  # set only when authenticated via API key
```

Update `get_current_user` to return `AuthContext`. When the incoming credential is a JWT, `api_key_project_id` is `None` (no scope restriction). When it is an API key, `api_key_project_id` is the project the key was issued for.

`require_project_member` enforces **both** conditions — user membership **and** key scope (when applicable):

```python
async def require_project_member(
    project_id: str,
    auth: AuthContext = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> Project:
    """
    Grants access only when ALL applicable conditions hold:
      1. auth.user is a member of project_id  (always checked)
      2. If auth was via API key: auth.api_key_project_id == project_id
         (key must be scoped to this exact project)
    Either condition failing alone is enough to deny access.
    """
    # Gate 1: API key scope (checked first — cheapest, no DB round-trip)
    if auth.api_key_project_id is not None and auth.api_key_project_id != project_id:
        raise HTTPException(status_code=403, detail="API key is not scoped to this project")

    # Gate 2: user membership
    stmt = (
        select(Project)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(Project.id == project_id, ProjectMember.user_id == auth.user.id)
    )
    result = await db.execute(stmt)
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=403, detail="Not a member of this project")

    return project
```

Both gates must pass. A valid API key whose user has been removed from the project is denied. A valid project member using an API key scoped to a different project is denied. JWT-authenticated users skip gate 1 entirely.

Callers that previously used `current_user: User` switch to `auth: AuthContext` and access `auth.user` where needed.

---

### ~~Task 9.5 — Apply membership check to all project-scoped endpoints~~  ✅ DONE (processes, datasets; workspaces/uploads are not project-scoped)

**Files**: `backend/routers/processes.py`, `backend/routers/datasets.py`, `backend/routers/workspaces.py`, `backend/routers/uploads.py`

Each endpoint that takes a `project_id` (as path param or query/body) should add:
```python
project: Project = Depends(require_project_member)
```
and use `project.id` rather than the raw param to prevent parameter tampering. Audit every endpoint — roughly 15–20 places total.

---

### ~~Task 9.6 — Membership management API endpoints~~  ✅ DONE

**File**: `backend/routers/projects.py` (or new `backend/routers/members.py`)

```
GET    /projects/{project_id}/members              → list members (username, email, joined_at)
GET    /projects/{project_id}/invites              → list pending invites (id, email, created_at, expires_at)
POST   /projects/{project_id}/invites              → invite by email (body: {email})
DELETE /projects/{project_id}/invites/{invite_id}  → cancel pending invite
DELETE /projects/{project_id}/members/me           → leave the project
```

**`POST /projects/{project_id}/invites` body**: `{email: string (optional)}`.

**`POST /projects/{project_id}/invites` logic**:
1. Check user is a member (`require_project_member`).
2. If email provided: check there is no pending unexpired invite for that email in this project, and check the email is not already a member.
3. Create `ProjectInvite` with `token = secrets.token_urlsafe(32)`, `expires_at = now + 7 days`.
4. Return the invite record **including the full invite URL** (`{settings.frontend_base_url}/invite/{token}`) — the token travels in the response, not only by email, so the inviter can share it via any channel.
5. If email was provided, also call `email_service.send_invite_email(...)` as a bonus delivery channel.

**`DELETE /projects/{project_id}/members/me` logic**:
- Remove the `ProjectMember` row for `current_user`.
- If this was the last member, the project is left with no members (orphaned). This is acceptable for now; add a guard later if needed.

---

### ~~Task 9.7 — Email service~~  ✅ DONE

**File**: `backend/services/email_service.py`, `backend/config.py`

Add to `config.py`:
```python
smtp_host:       Optional[str] = None    # If None, log the URL instead (dev mode)
smtp_port:       int           = 587
smtp_username:   Optional[str] = None
smtp_password:   Optional[str] = None
smtp_from_email: str           = "noreply@nagelfluh.example.com"
frontend_base_url: str         = "http://localhost:3000"
```

`email_service.py` — single function using `aiosmtplib` (add to `backend/requirements.txt`):
```python
async def send_invite_email(to_email: str, inviter_name: str, project_name: str, token: str):
    invite_url = f"{settings.frontend_base_url}/invite/{token}"
    if not settings.smtp_host:
        logger.info(f"[DEV] Invite URL for {to_email}: {invite_url}")
        return
    # send HTML email with invite_url
```

The dev-mode fallback (log instead of send) means the feature is fully testable without SMTP configuration.

---

### ~~Task 9.8 — Invite accept backend endpoint~~  ✅ DONE

**File**: `backend/routers/auth.py`

```
POST /auth/invites/{token}/accept
```

Requires `current_user` (must be logged in). Logic:
1. Look up `ProjectInvite` by token.
2. Reject if not found, expired (`expires_at < now`), or already accepted.
3. Check user is not already a member of the project.
4. Insert `ProjectMember(project_id=invite.project_id, user_id=current_user.id)`.
5. Set `invite.accepted_at = now`.
6. Return `{project_id, project_name}` so the frontend can redirect and select the project.

---

### ~~Task 9.9 — Frontend: invite accept page~~  ✅ DONE

**File**: new `frontend/src/InviteAcceptPage.js`, update `frontend/src/App.js` routing

Route: `/invite/:token`

Behaviour:
- **If logged in**: immediately call `POST /auth/invites/{token}/accept`. On success, store the returned `project_id` and navigate to `/app`, auto-selecting that project.
- **If not logged in**: save the token to `sessionStorage` under key `pendingInviteToken`, then redirect to `/` (login/signup page). After successful login/signup, the auth flow checks for `pendingInviteToken`, calls accept, clears the key, and navigates to `/app`.

The login/signup page (`LandingPage.js` or `AuthContext.js`) needs a post-auth hook or the accept logic can live in `AuthContext` as part of the login success handler.

---

### ~~Task 9.10 — Frontend: project member management panel~~  ✅ DONE

**Files**: new `frontend/src/ProjectMembersModal.js`, update `frontend/src/ProjectDropdown.js`

Add a "Manage Members..." item to `ProjectDropdown`. Opens `ProjectMembersModal` for the current project.

`ProjectMembersModal` has three sections:

**Members** — table with username, email, joined date. A "Leave project" button at the bottom (with `window.confirm` guard). Leaving calls `DELETE /projects/{projectId}/members/me`, then clears `currentProject` and closes.

**Invite** — form with an optional email field and a "Create Invite Link" button. On submit calls `POST /projects/{projectId}/invites`. On success, show the returned invite URL in a copyable text box (pre-selected / copy-to-clipboard button) so the inviter can paste it into Slack, WhatsApp, or any channel. If an email was provided the backend also sends it, shown as a secondary confirmation ("Invite email sent to …"). Error shown inline if email is already a member or has a pending invite.

**Pending Invites** — table of outstanding invites: email, sent date, expiry. Each row has a "Cancel" button → `DELETE /projects/{projectId}/invites/{inviteId}`.

---

### ~~Task 9.11 — Frontend: TanStack Query hooks for membership~~  ✅ DONE

**File**: `frontend/src/datamodel/useQueries.js` (or new `frontend/src/datamodel/useMembershipQueries.js`)

```js
useProjectMembers(projectId)      // GET /projects/{id}/members
useProjectInvites(projectId)      // GET /projects/{id}/invites
useInviteMember(projectId)        // POST mutation
useCancelInvite(projectId)        // DELETE mutation
useLeaveProject(projectId)        // DELETE mutation
useAcceptInvite()                 // POST /auth/invites/{token}/accept
```

Cache invalidation: after any membership mutation, call `invalidateProject(projectId)` and also invalidate the members/invites queries for that project.

---

### ~~Task 9.12 — Frontend: signup form email field~~  ✅ DONE

**File**: `frontend/src/LandingPage.js` (or wherever the signup form is)

Add an optional email field to the signup form. When arriving via an invite link the form should pre-fill the email from the invite record (the backend can expose a `GET /auth/invites/{token}` endpoint that returns `{email, project_name}` without requiring auth, so the page can greet the user with "You've been invited to join _X_").

Add `GET /auth/invites/{token}` to `backend/routers/auth.py` — public endpoint, returns `{email, project_name, inviter}` or 404/410.

---

### ~~Task 9.13 — API Keys (follow-on, depends on 9.1–9.8)~~  ✅ DONE

Once membership is solid, project-scoped API keys become straightforward:

**Model** (`backend/models/api_key.py`):
```python
class ApiKey(Base):
    __tablename__ = "api_keys"
    id         = Column(String(255), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    project_id = Column(String(255), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    label      = Column(String(255), nullable=False)
    key_hash   = Column(String(255), unique=True, nullable=False)  # bcrypt hash of the raw key
    expires_at = Column(DateTime, nullable=True)   # null = no expiry
    created_at = Column(DateTime, default=datetime.utcnow)
    last_used_at = Column(DateTime, nullable=True)
```

**Auth**: extend `get_current_user` to also accept `X-API-Key: apk_<random>` header (or `Authorization: Bearer apk_...` — pick one and document it). Hash the incoming key, look up in `api_keys`, validate expiry, and return `AuthContext(user=key.user, api_key_project_id=key.project_id)`. `require_project_member` (task 9.4) already enforces the dual-gate rule: the user must be a member of the requested project **and** the key's `project_id` must match. Revoking a key's user from the project is sufficient to deny access even if the key itself is still valid.

**Endpoints** (under `/auth/api-keys`): `POST` (create — return raw key once only), `GET` (list), `DELETE /{id}`.

**Frontend**: new "API Keys" card in `AccountPage.js`. Create form: label, project selector, optional expiry date. List existing keys (label, project, expiry, last used, delete button). Show raw key in a one-time modal on creation.

---

### ~~Task 9.14 — MCP server (follow-on, depends on 9.13)~~  ✅ DONE

Install `fastapi-mcp` (or equivalent). Mount MCP endpoint on the existing FastAPI app:

```python
from fastapi_mcp import FastApiMCP
mcp = FastApiMCP(app, include_tags=["Projects", "Processes", "Datasets"])
mcp.mount()  # adds /mcp SSE endpoint
```

Auth: API key via `Authorization: Bearer apk_...` header — same path as the REST API. No separate implementation.

Effort: ~1 day, mostly improving endpoint docstrings so MCP tool descriptions are useful.

---

### Implementation order

```
✅ 9.1  (email column)
✅ 9.2  (models + migration)          ← one migration covering both 9.1 and 9.2
✅ 9.3  (projects router auth)
✅ 9.4  (membership dependency)
✅ 9.5  (apply to all routers)        ← processes + datasets; workspaces/uploads not project-scoped
✅ 9.7  (email service)
✅ 9.6  (membership API)
✅ 9.8  (accept endpoint)
✅ 9.9  (invite accept page)
✅ 9.10 (members modal)
✅ 9.11 (query hooks)
✅ 9.12 (signup email field + public invite info endpoint)
─────────────────────────────────
✅ 9.13 (API keys)
✅ 9.14 (MCP server)
```

---

## Summary and Priorities

### High Priority (Core functionality)
1. **Plot cleanup** (#5) - Bug fix affecting current usability
2. ~~**Project membership** (#9, tasks 9.1–9.12)~~ ✅ DONE (2026-05-09)

### Medium Priority (Major features)
3. **Manual QC editor** (#8) - Improves data quality control
4. ~~**3D gridding** (#3)~~ ✅ DONE
5. ~~**API keys** (#9.13)~~ ✅ DONE
6. ~~**MCP server** (#9.14)~~ ✅ DONE

### Investigation/Long-term
7. ~~**3D visualization** (#4)~~ ✅ DONE (gladly)
8. ~~**Alternative plotting frameworks** (#6)~~ ✅ DONE (gladly)
9. **Map underlays** (#7) - ⚠️ Frontend done; server-side GeoTIFF publishing outstanding

---

## Notes for Implementation

### General Guidelines
- **Plan before implementing**: Discuss approach and get approval before making changes
- **No server starts**: Frontend and backend already running with auto-reload
- **No git commits**: User handles version control
- **Package installation**: Ask before installing, use `--save`/`--save-dev` for npm
- **Data access patterns**: Examine actual data structures first, prefer direct access over complex abstractions

### Architecture Resources
- Backend: `backend/main.py`, process types in `docker/base-runner/aem_processes/aem_processes/`
- Frontend: `frontend/src/`, widgets register in `App.js`
- Layout system: `frontend/src/flexout/`
- JSON Schema forms: `frontend/src/jsoneditor/`
- Dataset format: libaarhusxyz msgpack (XYZ + GEX)

### Key Libraries
- **Backend**: FastAPI, libaarhusxyz, SimPEG, swaggerspect
- **Frontend**: React, ReactFlow, Plotly, @rjsf/core, react-dnd
- **Potential new**: deck.gl, Cesium, three.js, TiTiler (WMS)
