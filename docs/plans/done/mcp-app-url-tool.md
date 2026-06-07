# MCP App URL Tool Plan

## Goal

Add an MCP tool that returns a deep-link URL the user can click to open the app at a specific
state — workspace, project, process, version, dataset part, and sounding. The primary use case
is an LLM agent that creates processes or configures workspaces and then hands the user a direct
link to the result, rather than making them navigate there manually.

---

## MCP Tool

| Tool | Description |
|------|-------------|
| `get_app_url` | Build a URL that opens the app with the specified state pre-selected. All parameters after `workspace_id` are optional — omit trailing ones to link at a coarser level (e.g. workspace only, or workspace + project + process with no sounding). Returns a URL string the user can click or open in a browser. |

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `workspace_id` | string (UUID) | yes | ID of the workspace layout to load. Use `list_workspaces` to discover available workspaces. |
| `project_id` | string (UUID) | no | ID of the project to select within the workspace. |
| `process_id` | string (UUID) | no | ID of the process to open. Requires `project_id`. |
| `version` | integer | no | Process version number to select. Requires `process_id`. |
| `part` | string | no | Dataset part name (e.g. a flightline name) to load. Requires `version`. |
| `sounding` | integer | no | Sounding index within the selected part. Requires `part`. |

### URL format

The frontend parses the following path structure (all segments optional after `w`):

```
{SERVER_URL}/app/w/{workspace_id}/p/{project_id}/pr/{process_id}/v/{version}/part/{part}/s/{sounding}
```

`SERVER_URL` is read from the server's environment config (e.g. `https://ymerflow.earth`).

---

## Why this is useful

The LLM workflow this enables:

1. Agent receives a user request ("plot the resistivity curtain for the latest inversion")
2. Agent calls `list_processes` / `create_process`, waits for completion
3. Agent calls `create_workspace` with a layout configured to show the result
4. Agent calls `get_app_url` with the workspace, project, process, version, and optionally a
   starting sounding
5. Agent returns the URL to the user — one click to land in the exact view

Without this tool the agent would have to instruct the user to navigate manually through the UI.

---

## Implementation

### Backend

**New endpoint** in `backend/routers/workspaces.py` (or a new `backend/routers/app_url.py`):

```python
@router.get("/app-url", tags=["Workspaces"])
def get_app_url(
    workspace_id: str,
    project_id: str | None = None,
    process_id: str | None = None,
    version: int | None = None,
    part: str | None = None,
    sounding: int | None = None,
    settings: Settings = Depends(get_settings),
) -> dict:
    """
    Build a URL that opens the app with the specified state pre-selected.
    Returns {"url": "https://..."}.
    """
    path = f"/app/w/{workspace_id}"
    if project_id:
        path += f"/p/{project_id}"
    if process_id:
        path += f"/pr/{process_id}"
    if version is not None:
        path += f"/v/{version}"
    if part:
        path += f"/part/{urllib.parse.quote(part, safe='')}"
    if sounding is not None:
        path += f"/s/{sounding}"
    return {"url": f"{settings.app_base_url}{path}"}
```

**Config**: read `SERVER_URL` from the existing settings model — it is already defined in
`config.env.example` as the public URL clients use to reach the app. Default to
`http://localhost:3000` for development (where `SERVER_URL` is typically unset).

**No ID validation**: the frontend handles missing or unknown IDs gracefully with auto-selection
fallbacks; backend validation would add round-trips for no user benefit.

### Frontend (no changes needed)

`ProcessContext.js` already implements `parseUrlParams()` (line 95) and `buildUrlPath()` (line
136) which handle the full URL structure including optional trailing segments. Deep-linking is
fully supported today.

---

## File Checklist

| File | Change |
|------|--------|
| `backend/routers/workspaces.py` (or new `app_url.py`) | Add `GET /app-url` endpoint tagged `"Workspaces"` |
| `backend/config.py` (or equivalent settings file) | Add `SERVER_URL` setting |
| `config.env.example` | `SERVER_URL` already documented — no change needed |
| `backend/main.py` | Import new router if in separate file |
