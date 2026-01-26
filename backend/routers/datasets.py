from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from typing import Optional
import io
import libaarhusxyz

from backend.database import get_db
from backend.models import Dataset, ProcessVersion, ProcessState
from backend.utils.xyz_utils import xyz_to_geojson
import fsspec

router = APIRouter(tags=["Datasets"])


@router.get("/datasets")
async def search_datasets(
    search: str = "",
    completed_only: bool = True,
    project_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Search datasets by process name or dataset name"""
    stmt = select(Dataset)

    # Filter by project_id if provided
    if project_id:
        stmt = stmt.where(Dataset.project_id == project_id)

    # Filter by search text
    if search:
        stmt = stmt.where(
            or_(
                Dataset.process_name.ilike(f"%{search}%"),
                Dataset.dataset_name.ilike(f"%{search}%")
            )
        )

    result = await db.execute(stmt)
    datasets = result.scalars().all()

    # Filter by completed processes if requested
    if completed_only:
        # Get completed process versions
        version_stmt = select(ProcessVersion).where(ProcessVersion.state == ProcessState.DONE)
        version_result = await db.execute(version_stmt)
        completed_versions = version_result.scalars().all()

        # Create set of (process_id, version) tuples
        completed_set = {(v.process_id, v.version) for v in completed_versions}

        # Filter datasets
        datasets = [
            d for d in datasets
            if (d.process_id, d.process_version) in completed_set
        ]

    return [d.to_dict() for d in datasets]


@router.get("/dataset/{dataset_id}")
async def get_dataset(dataset_id: str, db: AsyncSession = Depends(get_db)):
    """Get dataset metadata"""
    stmt = select(Dataset).where(Dataset.id == dataset_id)
    result = await db.execute(stmt)
    dataset = result.scalar_one_or_none()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    return dataset.to_dict()


@router.get("/dataset/{dataset_id}/data")
async def get_dataset_data(dataset_id: str, db: AsyncSession = Depends(get_db)):
    """Get dataset content"""
    stmt = select(Dataset).where(Dataset.id == dataset_id)
    result = await db.execute(stmt)
    dataset = result.scalar_one_or_none()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    if not dataset.file_url:
        raise HTTPException(status_code=404, detail="Dataset data not found")

    # Read file from storage
    with fsspec.open(dataset.file_url, 'rb') as f:
        data = f.read()

    return Response(
        content=data,
        media_type=dataset.mime_type
    )


@router.get("/dataset/{dataset_id}/geography")
async def get_dataset_geography(dataset_id: str, db: AsyncSession = Depends(get_db)):
    """Get GeoJSON geography for a dataset"""
    stmt = select(Dataset).where(Dataset.id == dataset_id)
    result = await db.execute(stmt)
    dataset = result.scalar_one_or_none()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    features = []

    # Handle XYZ datasets - derive geography from flightlines
    if dataset.mime_type == "application/x-aarhusxyz-msgpack":
        if dataset.file_url:
            # Load XYZ from file
            with fsspec.open(dataset.file_url, 'rb') as f:
                data = f.read()
            buffer = io.BytesIO(data)
            xyz_obj = libaarhusxyz.XYZ()
            xyz_obj.from_msgpack(buffer)

            xyz_data = {"xyz": xyz_obj, "gex": None}
            geojson = xyz_to_geojson(xyz_data)

            # Update properties with dataset_id
            for feature in geojson["features"]:
                feature["properties"]["dataset_id"] = dataset_id

            return geojson
    else:
        # Handle JSON datasets - generate mock GeoJSON
        if dataset.parts:
            for part_name in dataset.parts.keys():
                for i in range(2):
                    features.append({
                        "type": "Feature",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [-120.0 + i * 0.1, 39.0 + i * 0.1]
                        },
                        "properties": {
                            "dataset_id": dataset_id,
                            "index": i,
                            "part": part_name
                        }
                    })

    return {
        "type": "FeatureCollection",
        "features": features
    }


@router.get("/dataset/{dataset_id}/{part_path:path}/data")
async def get_dataset_part_data(dataset_id: str, part_path: str, db: AsyncSession = Depends(get_db)):
    """Get data for a specific part of a dataset"""
    stmt = select(Dataset).where(Dataset.id == dataset_id)
    result = await db.execute(stmt)
    dataset = result.scalar_one_or_none()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Get part info
    part_info = dataset.parts.get(part_path)
    if not part_info:
        raise HTTPException(status_code=404, detail="Part not found")

    # Read part file from storage
    part_file_url = part_info.get("file_url")
    if not part_file_url:
        raise HTTPException(status_code=404, detail="Part data not found")

    with fsspec.open(part_file_url, 'rb') as f:
        data = f.read()

    return Response(
        content=data,
        media_type=part_info["mime_type"]
    )


@router.get("/dataset/{dataset_id}/{part_path:path}/geography")
async def get_dataset_part_geography(dataset_id: str, part_path: str, db: AsyncSession = Depends(get_db)):
    """Get GeoJSON geography for a specific part of a dataset"""
    stmt = select(Dataset).where(Dataset.id == dataset_id)
    result = await db.execute(stmt)
    dataset = result.scalar_one_or_none()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Get part info
    part_info = dataset.parts.get(part_path)
    if not part_info:
        raise HTTPException(status_code=404, detail="Part not found")

    features = []

    # Handle XYZ datasets
    if dataset.mime_type == "application/x-aarhusxyz-msgpack":
        part_file_url = part_info.get("file_url")
        if part_file_url:
            # Load XYZ from file
            with fsspec.open(part_file_url, 'rb') as f:
                data = f.read()
            buffer = io.BytesIO(data)
            xyz_obj = libaarhusxyz.XYZ()
            xyz_obj.from_msgpack(buffer)

            xyz_data = {"xyz": xyz_obj, "gex": None}
            geojson = xyz_to_geojson(xyz_data, part_path=part_path)

            # Update properties with dataset_id
            for feature in geojson["features"]:
                feature["properties"]["dataset_id"] = dataset_id

            return geojson
    else:
        # Handle JSON datasets - generate mock GeoJSON
        for i in range(2):
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [-120.0 + i * 0.1, 39.0 + i * 0.1]
                },
                "properties": {
                    "dataset_id": dataset_id,
                    "index": i,
                    "part": part_path
                }
            })

    return {
        "type": "FeatureCollection",
        "features": features
    }
