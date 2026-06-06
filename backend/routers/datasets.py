from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, cast, String
from sqlalchemy.orm import selectinload
from typing import Optional
import asyncio
import fsspec
import re

from backend.database import get_db
from backend.models import Dataset, ProcessVersion, ProcessState, User, ProjectMember
from backend.services.auth_service import get_current_user, AuthContext
from backend.config import settings
from backend.services.storage_service import get_fsspec_storage_options


def _describe_xyz(data: bytes) -> dict:
    """Parse XYZ msgpack and return compact statistics."""
    import io
    from libaarhusxyz.export import msgpack as xyz_msgpack

    xyz, _ = xyz_msgpack.load(io.BytesIO(data), return_gex=True)
    fl = xyz.flightlines

    result = {"flightline_count": len(fl)}

    fl_cols = list(fl.columns)
    ld_cols = list(xyz.layer_data.keys()) if hasattr(xyz, "layer_data") and xyz.layer_data else []
    result["columns"] = fl_cols + ld_cols

    value_ranges = {}
    for col in fl_cols:
        try:
            s = fl[col]
            if hasattr(s, "dtype") and s.dtype.kind in ("f", "i", "u"):
                value_ranges[col] = [float(s.min()), float(s.max())]
        except Exception:
            pass
    result["value_ranges"] = value_ranges

    bbox = None
    for x_col, y_col in [("lon", "lat"), ("LONGITUDE", "LATITUDE"), ("UTMX", "UTMY"), ("easting", "northing"), ("x", "y")]:
        if x_col in fl.columns and y_col in fl.columns:
            x_min, x_max = float(fl[x_col].min()), float(fl[x_col].max())
            y_min, y_max = float(fl[y_col].min()), float(fl[y_col].max())
            if x_col in ("lon", "LONGITUDE"):
                bbox = {"west": x_min, "east": x_max, "south": y_min, "north": y_max}
            else:
                bbox = {"x_min": x_min, "x_max": x_max, "y_min": y_min, "y_max": y_max}
            break
    if bbox:
        result["bbox"] = bbox

    if hasattr(xyz, "model_info") and xyz.model_info:
        crs = xyz.model_info.get("projection")
        if crs:
            result["crs"] = crs

    return result


def _describe_json_bytes(data: bytes) -> dict:
    import json
    obj = json.loads(data.decode("utf-8", errors="replace"))
    if isinstance(obj, list):
        sample = obj[0] if obj and isinstance(obj[0], dict) else {}
        return {"record_count": len(obj), "keys": list(sample.keys())}
    elif isinstance(obj, dict):
        return {"keys": list(obj.keys())}
    return {}


def _describe_geojson(data: bytes) -> dict:
    import json
    obj = json.loads(data.decode("utf-8", errors="replace"))
    features = obj.get("features", [])
    result = {"feature_count": len(features)}
    lons, lats = [], []
    for f in features:
        geom = f.get("geometry") or {}
        coords = geom.get("coordinates")
        if not coords:
            continue
        gtype = geom.get("type", "")
        if gtype == "Point":
            lons.append(coords[0]); lats.append(coords[1])
        elif gtype in ("LineString", "MultiPoint"):
            for c in coords:
                lons.append(c[0]); lats.append(c[1])
        elif gtype in ("Polygon", "MultiLineString"):
            for ring in coords:
                for c in ring:
                    lons.append(c[0]); lats.append(c[1])
    if lons and lats:
        result["bbox"] = {"west": min(lons), "east": max(lons), "south": min(lats), "north": max(lats)}
    return result


def _describe_msgpack_generic(data: bytes) -> dict:
    import msgpack
    obj = msgpack.unpackb(data, raw=False)
    if isinstance(obj, dict):
        result = {"keys": list(obj.keys())}
        for key in ("data", "records", "items"):
            if key in obj and isinstance(obj[key], (list, dict)):
                result["record_count"] = len(obj[key])
                break
        return result
    elif isinstance(obj, list):
        return {"record_count": len(obj)}
    return {"type": type(obj).__name__}


def _compute_description(data: bytes, mime_type: str) -> dict:
    if mime_type == "application/x-aarhusxyz-msgpack":
        return _describe_xyz(data)
    elif mime_type == "application/geo+json":
        return _describe_geojson(data)
    elif mime_type in ("application/json",):
        return _describe_json_bytes(data)
    elif "msgpack" in mime_type:
        return _describe_msgpack_generic(data)
    else:
        return {"size_bytes": len(data)}

router = APIRouter(tags=["Datasets"])


@router.get("/datasets", summary="Search for output datasets")
async def search_datasets(
    search: str = "",
    completed_only: bool = True,
    project_id: Optional[str] = None,
    auth: AuthContext = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Search for datasets produced by completed processing jobs.

    Datasets are the outputs of processes. Each dataset has an 'id', a
    'url' (use in process params as an input), 'dataset_name', 'process_name',
    and 'mime_type'.

    The 'url' field can be downloaded directly with curl — no authentication required:
        curl "{url}" -o /tmp/result.msgpack

    The search string is matched case-insensitively against
    '<process_name> / v<version> / <dataset_name>'. Pass a process name or
    dataset name fragment to narrow results.

    Filter by project_id to restrict to one project. Set completed_only=false
    to also include datasets from still-running or failed jobs (rarely useful).
    """
    stmt = (
        select(Dataset)
        .options(selectinload(Dataset.process_version))
        .join(ProcessVersion, Dataset.process_version_id == ProcessVersion.id)
    )

    if project_id:
        # Enforce API key scope
        if auth.api_key_project_id is not None and auth.api_key_project_id != project_id:
            raise HTTPException(status_code=403, detail="API key is not scoped to this project")
        member_stmt = select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == auth.user.id
        )
        member_result = await db.execute(member_stmt)
        if not member_result.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Not a member of this project")
        stmt = stmt.where(Dataset.project_id == project_id)
    else:
        # When using an API key, restrict to the key's project
        if auth.api_key_project_id is not None:
            stmt = stmt.where(Dataset.project_id == auth.api_key_project_id)
        else:
            user_projects = select(ProjectMember.project_id).where(
                ProjectMember.user_id == auth.user.id
            ).scalar_subquery()
            stmt = stmt.where(Dataset.project_id.in_(user_projects))

    # Filter by search: case-insensitive substring match against the full display string
    # e.g. "FFT / 1" matches "Super cool FFT / 12 / output"
    if search:
        combined = (
            Dataset.process_name + ' / v' +
            cast(ProcessVersion.version, String) + ' / ' +
            Dataset.dataset_name
        )
        stmt = stmt.where(combined.ilike(f"%{search}%"))

    if completed_only:
        stmt = stmt.where(ProcessVersion.state == ProcessState.DONE)

    result = await db.execute(stmt)
    datasets = result.scalars().all()

    return [d.to_dict() for d in datasets]


@router.get("/dataset/{dataset_id}", summary="Get dataset metadata")
async def get_dataset(dataset_id: str, db: AsyncSession = Depends(get_db)):
    """Return metadata for a specific dataset including its mime_type, parts structure,
    and the process version that produced it.

    The 'url' field in the response is the actual file URL for the dataset's content.
    This URL can be downloaded directly with curl — no authentication is required:
        curl "{url}" -o /tmp/result.msgpack

    Use the 'url' field as input_data when passing this dataset to create_process.
    Use describe_dataset to inspect the dataset contents without downloading the full file.
    """
    stmt = select(Dataset).options(selectinload(Dataset.process_version)).where(Dataset.id == dataset_id)
    result = await db.execute(stmt)
    dataset = result.scalar_one_or_none()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    return dataset.to_dict()


@router.get("/dataset/{dataset_id}/describe", summary="Get compact statistics for a dataset")
async def describe_dataset(dataset_id: str, db: AsyncSession = Depends(get_db)):
    """Return compact metadata and statistics for a dataset without downloading the full content.

    Use this to understand what a dataset contains before deciding how to use it.
    Much cheaper than downloading the full dataset, especially for large AEM files.

    Returns (depending on mime_type):
    - XYZ/AEM (application/x-aarhusxyz-msgpack): flightline_count, columns,
      value_ranges for numeric columns, bbox, crs
    - GeoJSON: feature_count, bbox
    - JSON: record_count (if array), keys

    To download the full data, take the 'url' from get_dataset and use curl —
    no authentication is required for /files/ URLs.
    """
    stmt = select(Dataset).where(Dataset.id == dataset_id)
    result = await db.execute(stmt)
    dataset = result.scalar_one_or_none()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    primary_url = None
    if "files" in dataset.parts:
        primary_url = dataset.parts.get("files", {}).get(dataset.mime_type)
    elif "" in dataset.parts:
        root_part = dataset.parts.get("")
        primary_url = root_part.get("file_url") if root_part else None

    if not primary_url:
        return {"mime_type": dataset.mime_type, "error": "No data file found"}

    storage_options = get_fsspec_storage_options()

    def _read_and_describe():
        with fsspec.open(primary_url, "rb", **storage_options) as f:
            data = f.read()
        return _compute_description(data, dataset.mime_type)

    try:
        description = await asyncio.to_thread(_read_and_describe)
        description["mime_type"] = dataset.mime_type
        return description
    except Exception as e:
        return {"mime_type": dataset.mime_type, "error": str(e)}


@router.get("/dataset/{dataset_id}/data", include_in_schema=False)
async def get_dataset_data(dataset_id: str, db: AsyncSession = Depends(get_db)):
    """Download the raw content of a dataset's root part (frontend use only).

    For LLM agents: use the 'url' from get_dataset and download with curl instead —
    no authentication required. This endpoint is not exposed to MCP tools.
    """
    return await get_dataset_part_data(dataset_id, "", db)


@router.get("/dataset/{dataset_id}/geography", include_in_schema=False)
async def get_dataset_geography(dataset_id: str, db: AsyncSession = Depends(get_db)):
    """Get GeoJSON geography for a dataset (root part). Frontend use only."""
    return await get_dataset_part_geography(dataset_id, "", db)


@router.get("/dataset/{dataset_id}/{part_path:path}/data", include_in_schema=False)
async def get_dataset_part_data(dataset_id: str, part_path: str, db: AsyncSession = Depends(get_db)):
    """Get data for a specific part of a dataset"""
    stmt = select(Dataset).where(Dataset.id == dataset_id)
    result = await db.execute(stmt)
    dataset = result.scalar_one_or_none()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Determine format by checking structure
    is_new_format = "files" in dataset.parts and "parts" in dataset.parts

    part_file_url = None
    mime_type = dataset.mime_type

    if part_path == "":
        # Root part
        if is_new_format:
            # New format: files at top level
            part_file_url = dataset.parts.get("files", {}).get(dataset.mime_type)
        else:
            # Old format: parts[""] with file_url
            part_info = dataset.parts.get("")
            if part_info:
                part_file_url = part_info.get("file_url")
                mime_type = part_info.get("mime_type", dataset.mime_type)
    else:
        # Child part
        if is_new_format:
            # New format: parts nested under "parts" key
            parts_dict = dataset.parts.get("parts", {})
            part_info = parts_dict.get(part_path)
            if not part_info:
                raise HTTPException(status_code=404, detail="Part not found")

            if "files" in part_info and dataset.mime_type in part_info["files"]:
                part_file_url = part_info["files"][dataset.mime_type]
        else:
            # Old format: parts at top level
            part_info = dataset.parts.get(part_path)
            if not part_info:
                raise HTTPException(status_code=404, detail="Part not found")

            part_file_url = part_info.get("file_url")
            mime_type = part_info.get("mime_type", dataset.mime_type)

    if not part_file_url:
        raise HTTPException(status_code=404, detail="Part data not found")

    storage_options = get_fsspec_storage_options()
    def _read():
        with fsspec.open(part_file_url, 'rb', **storage_options) as f:
            return f.read()
    data = await asyncio.to_thread(_read)

    return Response(
        content=data,
        media_type=mime_type
    )


@router.get("/dataset/{dataset_id}/{part_path:path}/geography", include_in_schema=False)
async def get_dataset_part_geography(dataset_id: str, part_path: str, db: AsyncSession = Depends(get_db)):
    """Get GeoJSON geography for a specific part of a dataset. Frontend use only."""
    stmt = select(Dataset).where(Dataset.id == dataset_id)
    result = await db.execute(stmt)
    dataset = result.scalar_one_or_none()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Determine format by checking structure
    is_new_format = "files" in dataset.parts and "parts" in dataset.parts

    part_geography_url = None

    if part_path == "":
        # Root part
        if is_new_format:
            # New format: files at top level
            part_geography_url = dataset.parts.get("files", {}).get("application/geo+json")
        else:
            # Old format: parts[""] with geography_url
            part_info = dataset.parts.get("")
            if part_info:
                part_geography_url = part_info.get("geography_url")
    else:
        # Child part
        if is_new_format:
            # New format: parts nested under "parts" key
            parts_dict = dataset.parts.get("parts", {})
            part_info = parts_dict.get(part_path)
            if not part_info:
                raise HTTPException(status_code=404, detail="Part not found")

            if "files" in part_info and "application/geo+json" in part_info["files"]:
                part_geography_url = part_info["files"]["application/geo+json"]
        else:
            # Old format: parts at top level
            part_info = dataset.parts.get(part_path)
            if not part_info:
                raise HTTPException(status_code=404, detail="Part not found")

            part_geography_url = part_info.get("geography_url")

    if not part_geography_url:
        raise HTTPException(status_code=404, detail="Part geography not found")

    storage_options = get_fsspec_storage_options()
    def _read():
        with fsspec.open(part_geography_url, 'r', **storage_options) as f:
            return f.read()
    data = await asyncio.to_thread(_read)

    return Response(
        content=data,
        media_type="application/geo+json"
    )


@router.get("/files/{path:path}", include_in_schema=False)
async def get_file(path: str):
    """Unified file endpoint for datasets and uploads (frontend / curl use only).

    Auth-free: any /files/ URL can be fetched with a plain curl — no token needed.
    LLM agents should use this URL directly rather than calling this as an MCP tool.

    Translates HTTP paths to storage URLs and serves the files.

    Examples:
        /files/project-bucket/processes/proc-123/datasets/ds-456/root.msgpack
        -> s3://project-bucket/processes/proc-123/datasets/ds-456/root.msgpack

        /files/project-bucket/uploads/up-789/file.csv
        -> s3://project-bucket/uploads/up-789/file.csv
    """
    # Construct storage URL
    protocol = settings.storage_protocol
    storage_url = f"{protocol}://{path}"

    # Determine MIME type based on file extension
    mime_type = "application/octet-stream"
    if path.endswith('.msgpack'):
        mime_type = "application/x-aarhusxyz-msgpack"
    elif path.endswith('.geojson'):
        mime_type = "application/geo+json"
    elif path.endswith('.json'):
        mime_type = "application/json"
    elif path.endswith('.csv'):
        mime_type = "text/csv"
    elif path.endswith('.txt'):
        mime_type = "text/plain"

    # Read file from storage
    storage_options = get_fsspec_storage_options()
    try:
        mode = 'r' if mime_type in ("application/geo+json", "application/json", "text/csv", "text/plain") else 'rb'
        def _read():
            with fsspec.open(storage_url, mode, **storage_options) as f:
                return f.read()
        data = await asyncio.to_thread(_read)

        # Determine if this is a download (uploads) or inline (datasets)
        headers = {}
        if '/uploads/' in path:
            # Extract filename from path
            filename = path.split('/')[-1]
            headers["Content-Disposition"] = f'attachment; filename="{filename}"'

        return Response(
            content=data,
            media_type=mime_type,
            headers=headers
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading file: {str(e)}")
