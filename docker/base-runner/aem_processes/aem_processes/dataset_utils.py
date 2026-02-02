"""Utility functions for writing and managing datasets."""

import uuid
import json
import io
import fsspec
import slugify


def write_dataset(xyz, gex, dataset_name, process_id, storage_base, storage_kwargs):
    """Write a dataset to storage with msgpack, geojson, and flight line parts.

    Args:
        xyz: libaarhusxyz.XYZ instance
        gex: libaarhusxyz.GEX instance
        dataset_name: Name for this dataset
        process_id: Process ID
        storage_base: Storage base URL
        storage_kwargs: fsspec storage arguments

    Returns:
        Dataset ID (UUID string)
    """
    dataset_id = str(uuid.uuid4())
    dataset_prefix = f"{storage_base}/processes/{process_id}/datasets/{dataset_id}"

    # Write root msgpack
    root_file_url = f"{dataset_prefix}/root.msgpack"
    print(f"Writing msgpack to: {root_file_url}")

    with fsspec.open(root_file_url, 'wb', **storage_kwargs) as f:
        xyz.to_msgpack(f, gex=gex)

    # Write root geography (GeoJSON)
    geojson_buffer = io.StringIO()
    xyz.to_geojson(geojson_buffer)
    root_geojson = json.loads(geojson_buffer.getvalue())
    for feature in root_geojson.get("features", []):
        if "properties" not in feature:
            feature["properties"] = {}
        feature["properties"]["dataset_id"] = dataset_id

    root_geography_url = f"{dataset_prefix}/root.geojson"
    print(f"Writing geography to: {root_geography_url}")

    with fsspec.open(root_geography_url, 'w', **storage_kwargs) as f:
        json.dump(root_geojson, f)

    # Split by flight lines and write parts
    parts = {
        "": {
            "file_url": root_file_url,
            "mime_type": "application/x-aarhusxyz-msgpack",
            "geography_url": root_geography_url
        }
    }

    if "title" in xyz.flightlines.columns:
        print("Splitting by flight lines...")
        for fline, line_xyz in xyz.split_by_line().items():
            fline_str = slugify.slugify(str(fline), separator="_")

            # Write part msgpack
            part_file_url = f"{dataset_prefix}/parts/{fline_str}.msgpack"
            print(f"Writing part {fline_str} to: {part_file_url}")

            with fsspec.open(part_file_url, 'wb', **storage_kwargs) as f:
                line_xyz.to_msgpack(f, gex=gex)

            # Write part geography
            part_geojson_buffer = io.StringIO()
            line_xyz.to_geojson(part_geojson_buffer)
            part_geojson = json.loads(part_geojson_buffer.getvalue())
            for feature in part_geojson.get("features", []):
                if "properties" not in feature:
                    feature["properties"] = {}
                feature["properties"]["dataset_id"] = dataset_id

            part_geography_url = f"{dataset_prefix}/parts/{fline_str}.geojson"

            with fsspec.open(part_geography_url, 'w', **storage_kwargs) as f:
                json.dump(part_geojson, f)

            parts[fline_str] = {
                "file_url": part_file_url,
                "mime_type": "application/x-aarhusxyz-msgpack",
                "geography_url": part_geography_url
            }

    # Write dataset info.json
    dataset_info = {
        "id": dataset_id,
        "mime_type": "application/x-aarhusxyz-msgpack",
        "dataset_name": dataset_name,
        "parts": parts
    }

    info_url = f"{dataset_prefix}/info.json"
    print(f"Writing dataset info to: {info_url}")

    with fsspec.open(info_url, 'w', **storage_kwargs) as f:
        json.dump(dataset_info, f, indent=2)

    return dataset_id
