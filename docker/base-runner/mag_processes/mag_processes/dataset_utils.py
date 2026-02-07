"""Utility functions for writing MagData datasets to storage."""

import uuid
import json
import tempfile
import os
import io

import fsspec
import geopandas as gpd
import shapely.geometry


def ensure_web_coordinates(mag_data):
    """Ensure mag_data has x_web and y_web columns in Web Mercator (EPSG:3857).

    If the columns don't exist, create them by converting from easting/northing
    using the CRS specified in mag_data.meta.

    Args:
        mag_data: MagData instance

    Returns:
        Modified MagData instance with x_web and y_web columns
    """
    if "x_web" in mag_data.data.columns and "y_web" in mag_data.data.columns:
        return mag_data

    # Get the geodataframe which handles CRS conversion
    gdf = mag_data.as_geodataframe()  # This converts to EPSG:3857

    # Extract x_web and y_web from the converted geometry
    mag_data.data["x_web"] = gdf.geometry.x
    mag_data.data["y_web"] = gdf.geometry.y

    return mag_data


def mag_data_to_geojson(mag_data, dataset_id=None):
    """Convert MagData to GeoJSON with LineString geometries grouped by line.

    Similar to libaarhusxyz's to_geojson, creates LineStrings for each flight
    line using Web Mercator coordinates.

    Args:
        mag_data: MagData instance with x_web and y_web columns
        dataset_id: Optional dataset ID to add to feature properties

    Returns:
        GeoJSON dict
    """
    # Ensure we have web coordinates
    mag_data = ensure_web_coordinates(mag_data)

    # Reset index to get line as a column (if it exists)
    df = mag_data.data.reset_index()

    # Create point geometry from Web Mercator coordinates
    xy = gpd.points_from_xy(df.x_web, df.y_web, crs=3857)
    points = gpd.GeoDataFrame(df, geometry=xy)

    # Check if we have a "line" column (multi-line data) or single-line data
    if "line" in points.columns:
        # Group by line and create LineStrings
        lines = points.groupby("line")["geometry"].apply(
            lambda x: shapely.geometry.LineString(x.tolist())
        )

        # Create GeoDataFrame with line metadata
        lines_gdf = gpd.GeoDataFrame(
            points.groupby("line").first(), geometry=lines
        ).reset_index()
    else:
        # Single line dataset - create one LineString from all points
        line_geometry = shapely.geometry.LineString(points.geometry.tolist())
        lines_gdf = gpd.GeoDataFrame(
            points.iloc[[0]].drop(columns=['geometry']),
            geometry=[line_geometry]
        )

    # Convert to GeoJSON
    geojson = json.loads(lines_gdf.to_json())

    # Add dataset_id to feature properties if provided
    if dataset_id:
        for feature in geojson.get("features", []):
            if "properties" not in feature:
                feature["properties"] = {}
            feature["properties"]["dataset_id"] = dataset_id

    return geojson


def write_dataset(mag_data, dataset_name, process_id, storage_base, storage_kwargs):
    """Write a MagData instance to storage as msgpack.

    Creates a dataset directory with a root msgpack file and an info.json
    manifest, following the same layout convention as aem_processes.
    Also writes separate msgpack files for each line number.

    MagData.save() requires a local filesystem path, so the msgpack is
    written to a temporary file first and then copied through fsspec to
    the target storage backend.

    Args:
        mag_data: AirMagTools.MagData instance
        dataset_name: Human-readable name for this dataset
        process_id: Process ID (UUID string)
        storage_base: Base URL for the storage backend
        storage_kwargs: fsspec open() keyword arguments

    Returns:
        Dataset ID (UUID string)
    """
    dataset_id = str(uuid.uuid4())
    dataset_prefix = f"{storage_base}/processes/{process_id}/datasets/{dataset_id}"
    msgpack_url = f"{dataset_prefix}/root.msgpack"

    # Ensure web coordinates are present
    mag_data = ensure_web_coordinates(mag_data)

    # Write root msgpack (all data)
    print(f"Writing root msgpack to: {msgpack_url}")
    with tempfile.NamedTemporaryFile(suffix=".msgpack", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        mag_data.save(tmp_path)
        with open(tmp_path, "rb") as src:
            with fsspec.open(msgpack_url, "wb", **storage_kwargs) as dst:
                dst.write(src.read())
    finally:
        os.unlink(tmp_path)

    # Write root geography (GeoJSON)
    root_geography_url = f"{dataset_prefix}/root.geojson"
    print(f"Writing root geography to: {root_geography_url}")
    root_geojson = mag_data_to_geojson(mag_data, dataset_id=dataset_id)
    with fsspec.open(root_geography_url, "w", **storage_kwargs) as f:
        json.dump(root_geojson, f)

    # Build top-level files
    files = {
        "application/x-magdata-msgpack": msgpack_url,
        "application/geo+json": root_geography_url
    }

    # Write separate parts for each line
    parts = {}
    lines = mag_data.get_lines()
    print(f"Writing {len(lines)} line parts...")
    for line in lines:
        # Filter data to this specific line
        line_data = mag_data.data.loc[line]

        # Create a new MagData instance for this line
        line_mag_data = type(mag_data)(line_data, **mag_data.meta)

        # Write line msgpack part
        line_str = str(line)
        line_msgpack_url = f"{dataset_prefix}/parts/{line_str}.msgpack"

        with tempfile.NamedTemporaryFile(suffix=".msgpack", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            line_mag_data.save(tmp_path)
            with open(tmp_path, "rb") as src:
                with fsspec.open(line_msgpack_url, "wb", **storage_kwargs) as dst:
                    dst.write(src.read())
        finally:
            os.unlink(tmp_path)

        # Write line geography part
        line_geography_url = f"{dataset_prefix}/parts/{line_str}.geojson"
        line_geojson = mag_data_to_geojson(line_mag_data, dataset_id=dataset_id)
        with fsspec.open(line_geography_url, "w", **storage_kwargs) as f:
            json.dump(line_geojson, f)

        # Add to parts dictionary
        parts[line_str] = {
            "files": {
                "application/x-magdata-msgpack": line_msgpack_url,
                "application/geo+json": line_geography_url
            }
        }

    # Write dataset manifest
    dataset_info = {
        "id": dataset_id,
        "mime_type": "application/x-magdata-msgpack",
        "dataset_name": dataset_name,
        "files": files,
        "parts": parts,
    }

    info_url = f"{dataset_prefix}/info.json"
    print(f"Writing dataset info to: {info_url}")
    with fsspec.open(info_url, "w", **storage_kwargs) as f:
        json.dump(dataset_info, f, indent=2)

    return dataset_id
