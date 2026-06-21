"""Utility functions for writing MagData datasets to storage."""

import uuid
import json
import tempfile
import os
import io
import zipfile
import yaml

import fsspec
import geopandas as gpd
import shapely.geometry
from .stats import compute_mag_stats, compute_grid_stats, STATS_MIME


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


def write_dataset(mag_data, dataset_name, process_id, process_version, storage_base, storage_kwargs):
    """Write a MagData instance to storage in all supported formats.

    Creates a dataset directory with root files in multiple formats and an info.json
    manifest, following the same layout convention as aem_processes.
    Also writes separate files for each line number.

    MagData.save() requires a local filesystem path, so files are
    written to temporary files first and then copied through fsspec to
    the target storage backend.

    Args:
        mag_data: AirMagTools.MagData instance
        dataset_name: Human-readable name for this dataset
        process_id: Process ID (UUID string)
        process_version: Process version number (string or int)
        storage_base: Base URL for the storage backend
        storage_kwargs: fsspec open() keyword arguments

    Returns:
        Dataset ID (UUID string)
    """
    dataset_id = str(uuid.uuid4())
    dataset_prefix = f"{storage_base}/processes/{process_id}/{process_version}/datasets/{dataset_id}"

    # Ensure web coordinates are present
    mag_data = ensure_web_coordinates(mag_data)

    # Write root msgpack (all data)
    msgpack_url = f"{dataset_prefix}/root.msgpack"
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

    # Write root ZIP (CSV + YAML - native AirMagTools format)
    zip_url = f"{dataset_prefix}/root.zip"
    print(f"Writing root ZIP to: {zip_url}")
    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        with zipfile.ZipFile(tmp_path, 'w') as z:
            csv_buffer = io.StringIO()
            mag_data.data.reset_index().to_csv(csv_buffer, index=False)
            z.writestr("data.csv", csv_buffer.getvalue())
            z.writestr("meta.yaml", yaml.dump(mag_data.meta))

        with open(tmp_path, "rb") as src:
            with fsspec.open(zip_url, "wb", **storage_kwargs) as dst:
                dst.write(src.read())
    finally:
        os.unlink(tmp_path)

    # Write root geography (GeoJSON)
    root_geography_url = f"{dataset_prefix}/root.geojson"
    print(f"Writing root geography to: {root_geography_url}")
    root_geojson = mag_data_to_geojson(mag_data, dataset_id=dataset_id)
    with fsspec.open(root_geography_url, "w", **storage_kwargs) as f:
        json.dump(root_geojson, f)

    # Write root stats
    root_stats_url = f"{dataset_prefix}/stats.json"
    print(f"Writing stats to: {root_stats_url}")
    with fsspec.open(root_stats_url, "w", **storage_kwargs) as f:
        json.dump(compute_mag_stats(mag_data), f, indent=2)

    # Build top-level files
    files = {
        "application/x-magdata-msgpack": msgpack_url,
        "application/zip": zip_url,
        "application/geo+json": root_geography_url,
        STATS_MIME: root_stats_url,
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

        line_str = str(line)

        # Write line msgpack part
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

        # Write line ZIP part
        line_zip_url = f"{dataset_prefix}/parts/{line_str}.zip"

        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            import zipfile
            import yaml
            with zipfile.ZipFile(tmp_path, 'w') as z:
                csv_buffer = io.StringIO()
                line_mag_data.data.reset_index().to_csv(csv_buffer, index=False)
                z.writestr("data.csv", csv_buffer.getvalue())
                z.writestr("meta.yaml", yaml.dump(line_mag_data.meta))

            with open(tmp_path, "rb") as src:
                with fsspec.open(line_zip_url, "wb", **storage_kwargs) as dst:
                    dst.write(src.read())
        finally:
            os.unlink(tmp_path)

        # Write line geography part
        line_geography_url = f"{dataset_prefix}/parts/{line_str}.geojson"
        line_geojson = mag_data_to_geojson(line_mag_data, dataset_id=dataset_id)
        with fsspec.open(line_geography_url, "w", **storage_kwargs) as f:
            json.dump(line_geojson, f)

        # Write part stats
        part_stats_url = f"{dataset_prefix}/parts/{line_str}.stats.json"
        with fsspec.open(part_stats_url, "w", **storage_kwargs) as f:
            json.dump(compute_mag_stats(line_mag_data), f, indent=2)

        # Add to parts dictionary
        parts[line_str] = {
            "files": {
                "application/x-magdata-msgpack": line_msgpack_url,
                "application/zip": line_zip_url,
                "application/geo+json": line_geography_url,
                STATS_MIME: part_stats_url,
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


def write_webxtile_dataset(
    ds, dataset_name, process_id, process_version, storage_base, storage_kwargs
):
    """Write an xarray Dataset to storage as a webxtile tile tree.

    The Dataset is written to a local temp directory first (webxtile requires
    a local path), then all tile files are uploaded to storage via fsspec.

    Args:
        ds: xarray.Dataset with webxtile accessor available
        dataset_name: Human-readable name for this dataset
        process_id: Process ID (UUID string)
        process_version: Process version number (string or int)
        storage_base: Base URL for the storage backend
        storage_kwargs: fsspec storage arguments

    Returns:
        Dataset ID (UUID string)
    """
    import uuid
    import os
    import shutil
    import tempfile
    import fsspec

    dataset_id = str(uuid.uuid4())
    dataset_prefix = f"{storage_base}/processes/{process_id}/{process_version}/datasets/{dataset_id}"

    with tempfile.TemporaryDirectory() as tmp_dir:
        tile_local = os.path.join(tmp_dir, "tiles")
        print(f"Writing webxtile to local temp: {tile_local}")
        ds.webxtile.to_webxtile(tile_local)

        # Upload every file in the tile tree
        for root, dirs, files in os.walk(tile_local):
            for fname in files:
                local_path = os.path.join(root, fname)
                rel_path = os.path.relpath(local_path, tile_local)
                remote_url = f"{dataset_prefix}/tiles/{rel_path}"
                print(f"Uploading {rel_path} → {remote_url}")
                with open(local_path, "rb") as src:
                    with fsspec.open(remote_url, "wb", **storage_kwargs) as dst:
                        dst.write(src.read())

    # Write stats
    stats_url = f"{dataset_prefix}/stats.json"
    print(f"Writing stats to: {stats_url}")
    with fsspec.open(stats_url, "w", **storage_kwargs) as f:
        json.dump(compute_grid_stats(ds), f, indent=2)

    # Dataset manifest — root tile is metadata.msgpack per webxtile convention
    root_tile_url = f"{dataset_prefix}/tiles/metadata.msgpack"
    files = {
        "application/x-webxtile": root_tile_url,
        STATS_MIME: stats_url,
    }

    dataset_info = {
        "id": dataset_id,
        "mime_type": "application/x-webxtile",
        "dataset_name": dataset_name,
        "files": files,
        "parts": {},
    }

    info_url = f"{dataset_prefix}/info.json"
    print(f"Writing dataset info to: {info_url}")
    with fsspec.open(info_url, "w", **storage_kwargs) as f:
        json.dump(dataset_info, f, indent=2)

    return dataset_id
