# File Upload / Download — MCP Smoothness Plan

**Context:** When Claude uses MCP to import or export data, the current workflow is
painful: find the API token in Claude's config, write a Python script to do
multipart upload or fetch authenticated URLs. This plan eliminates that entirely.

---

## Deployment facts (affects design)

- Backend runs remotely at **ymerflow.earth** — not co-located with Claude Code.
- MinIO is **internal to the cluster** — presigned direct-MinIO URLs won't reach
  the client machine. All file I/O proxies through FastAPI.
- `GET /files/{path}` and all `GET /dataset/*` endpoints have **no auth** — any
  file can be fetched with a plain `curl` once you have the path.
- `POST /upload` requires auth (handled transparently by the MCP server).

---

## Problem breakdown

| Problem | Root cause |
|---|---|
| Upload requires token + custom script | MCP's JSON interface can't send multipart/form-data binary; `UploadFile` endpoint is unreachable from MCP tools |
| Large-file upload has no clean path | Even with JSON/base64, encoding a 50 MB XYZ file would be impractical |
| Download for inspection requires libaarhusxyz parser script | `/files/` returns binary msgpack; Claude can't read it inline |
| Claude writes auth scripts for downloads | Doesn't know `/files/` URLs are already auth-free |

---

## Design decisions

### 1. Upload — extend existing `POST /upload` (not a new endpoint)

Modify `backend/routers/uploads.py` to accept two body formats, **auto-detected
from `Content-Type`**:

**`multipart/form-data`** (unchanged — browser / curl):
```
curl -F "file=@data.xyz" "https://ymerflow.earth/upload?project_id=..."
```

Optional `encoding=base64` form field: if present and `"base64"`, the file
content is base64-decoded before storage. Useful for clients that can't send
binary multipart.

**`application/json`** (new — MCP-friendly):
```json
{"filename": "data.xyz", "content": "<base64>", "content_type": "application/x-aarhusxyz-msgpack"}
```
Server decodes `content` from base64 before storing. `content_type` is optional
(defaults to `application/octet-stream`).

Implementation: switch from `file: UploadFile = File(...)` to reading `Request`
directly, branching on `Content-Type` header. `project_id` stays as a query
param. Auth unchanged.

Docstring must include both curl examples so the MCP tool description explains
both calling conventions.

Practical size limit: JSON/base64 is fine for typical text imports (CSV, JSON,
small XYZ). For large binary surveys (tens of MB+) use the upload-token path
below.

---

### 2. Large-file upload — upload token endpoint

For files too large for base64-in-JSON, a two-step flow:

**Step 1** — Claude calls MCP:
```
POST /upload/request-token?project_id=...&filename=survey.xyz&content_type=...
→ {"upload_url": "https://ymerflow.earth/upload/with-token/TOKEN", "file_id": "...", "expires_in": 3600}
```
Token is short-lived (~1 h), single-use. No auth header needed on the upload URL
itself — the token carries the authorization.

**Step 2** — Claude runs locally (no auth header):
```
curl -X POST "https://ymerflow.earth/upload/with-token/TOKEN" -F "file=@/path/to/survey.xyz"
```

The `with-token` endpoint validates the token, stores the file, and returns the
same `{id, filename, url}` response as the normal upload.

---

### 3. Download — no auth change needed

`/files/` is already auth-free. The fix is **documentation and tool description**:

- `GET /dataset/{id}` docstring should explicitly state:
  *"The `url` field can be downloaded directly with `curl` — no authentication
  required."*
- Same note on `search_datasets` and wherever dataset URLs appear.

Claude should then be able to do `curl "{url}" -o /tmp/result.xyz` without any
token handling.

---

### 4. Dataset investigation — `GET /dataset/{id}/describe`

New endpoint returning a compact human-readable summary so Claude can understand
what a dataset contains without downloading binary msgpack or writing a parser:

```json
{
  "mime_type": "application/x-aarhusxyz-msgpack",
  "flightline_count": 42,
  "sounding_count": 18340,
  "columns": ["xdist_m", "elevation_m", "DOI_Layer1", "resistivity"],
  "value_ranges": {"elevation_m": [22.1, 441.8], "DOI_Layer1": [0.0, 280.0]},
  "bbox": {"west": 8.12, "east": 9.31, "south": 55.21, "north": 56.07},
  "crs": 32632
}
```

Implementation: download the dataset from storage via fsspec, parse with
libaarhusxyz (XYZ) or msgpack (MagData/JSON), compute stats server-side, return
JSON. No auth required (consistent with other dataset read endpoints).

Optionally add `GET /dataset/{id}/sample?n=50&format=csv` later (first N rows as
CSV) for deeper inline inspection.

---

## Implementation order

| Priority | Item | File(s) |
|---|---|---|
| 1 | Extend `POST /upload` with JSON+base64 auto-detection | `backend/routers/uploads.py` |
| 2 | `GET /dataset/{id}/describe` | `backend/routers/datasets.py` |
| 3 | Add auth-free download note to `get_dataset` / `search_datasets` docstrings | `backend/routers/datasets.py` |
| 4 | Upload token (`POST /upload/request-token` + `POST /upload/with-token/{token}`) | `backend/routers/uploads.py`, `backend/models.py` |
| 5 | `GET /dataset/{id}/sample?format=csv&n=N` | `backend/routers/datasets.py` |
