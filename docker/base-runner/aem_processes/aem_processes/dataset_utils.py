"""Utility functions for writing and managing datasets."""

import uuid
import json
import io
import fsspec
import slugify
from .stats import compute_xyz_stats, STATS_MIME


def write_dataset(xyz, gex, dataset_name, process_id, process_version, storage_base, storage_kwargs):
    """Write a dataset to storage with all supported formats and flight line parts.

    Args:
        xyz: libaarhusxyz.XYZ instance (must be normalized before calling this)
        gex: libaarhusxyz.GEX instance
        dataset_name: Name for this dataset
        process_id: Process ID
        process_version: Process version number (string or int)
        storage_base: Storage base URL
        storage_kwargs: fsspec storage arguments

    Returns:
        Dataset ID (UUID string)

    Note:
        The xyz object must be normalized before calling this function.
        The split_by_line() method relies on xyz.line_id_column which
        is only available after normalization.
    """
    dataset_id = str(uuid.uuid4())
    dataset_prefix = f"{storage_base}/processes/{process_id}/{process_version}/datasets/{dataset_id}"

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

    # Write root XYZ (Aarhus text format)
    root_xyz_url = f"{dataset_prefix}/root.xyz"
    print(f"Writing XYZ to: {root_xyz_url}")

    with fsspec.open(root_xyz_url, 'wb', **storage_kwargs) as f:
        xyz.dump(f)

    # Write GEX (system configuration)
    root_gex_url = f"{dataset_prefix}/root.gex"
    print(f"Writing GEX to: {root_gex_url}")

    with fsspec.open(root_gex_url, 'wb', **storage_kwargs) as f:
        gex.dump(f)

    # Write root stats
    root_stats_url = f"{dataset_prefix}/stats.json"
    print(f"Writing stats to: {root_stats_url}")
    with fsspec.open(root_stats_url, 'w', **storage_kwargs) as f:
        json.dump(compute_xyz_stats(xyz), f, indent=2)

    # Build top-level files
    files = {
        "application/x-aarhusxyz-msgpack": root_file_url,
        "application/geo+json": root_geography_url,
        "text/x-aarhusxyz": root_xyz_url,
        "text/x-aarhusxyz-gex": root_gex_url,
        STATS_MIME: root_stats_url,
    }

    # Write VTK and GLB if model has layer_data (resistivity models only)
    if hasattr(xyz, 'layer_data') and xyz.layer_data:
        try:
            # Write root VTK
            root_vtk_url = f"{dataset_prefix}/root.vtk"
            print(f"Writing VTK to: {root_vtk_url}")

            with fsspec.open(root_vtk_url, 'w', **storage_kwargs) as f:
                xyz.to_vtk(f)

            files["model/vnd.vtk"] = root_vtk_url

            # Write root GLB
            root_glb_url = f"{dataset_prefix}/root.glb"
            print(f"Writing GLB to: {root_glb_url}")

            glb_buffer = io.BytesIO()
            xyz.to_glb(glb_buffer)
            glb_buffer.seek(0)

            with fsspec.open(root_glb_url, 'wb', **storage_kwargs) as f:
                f.write(glb_buffer.read())

            files["model/gltf-binary"] = root_glb_url
        except Exception as e:
            print(f"Warning: Could not write 3D formats (VTK/GLB): {e}")
            print("Continuing without 3D model exports...")

    # Split by flight lines and write parts
    parts = {}

    # Use xyz.line_id_column property which handles all column name variants
    if xyz.line_id_column and len(xyz.flightlines) > 1:
        print(f"Splitting {len(xyz.flightlines)} soundings into flight lines using column '{xyz.line_id_column}'...")
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

            # Write part XYZ
            part_xyz_url = f"{dataset_prefix}/parts/{fline_str}.xyz"

            with fsspec.open(part_xyz_url, 'wb', **storage_kwargs) as f:
                line_xyz.dump(f)

            # Write part stats
            part_stats_url = f"{dataset_prefix}/parts/{fline_str}.stats.json"
            with fsspec.open(part_stats_url, 'w', **storage_kwargs) as f:
                json.dump(compute_xyz_stats(line_xyz), f, indent=2)

            part_files = {
                "application/x-aarhusxyz-msgpack": part_file_url,
                "application/geo+json": part_geography_url,
                "text/x-aarhusxyz": part_xyz_url,
                STATS_MIME: part_stats_url,
            }

            # Write VTK and GLB for parts if available
            if hasattr(line_xyz, 'layer_data') and line_xyz.layer_data:
                try:
                    # Write part VTK
                    part_vtk_url = f"{dataset_prefix}/parts/{fline_str}.vtk"

                    with fsspec.open(part_vtk_url, 'w', **storage_kwargs) as f:
                        line_xyz.to_vtk(f)

                    part_files["model/vnd.vtk"] = part_vtk_url

                    # Write part GLB
                    part_glb_url = f"{dataset_prefix}/parts/{fline_str}.glb"

                    part_glb_buffer = io.BytesIO()
                    line_xyz.to_glb(part_glb_buffer)
                    part_glb_buffer.seek(0)

                    with fsspec.open(part_glb_url, 'wb', **storage_kwargs) as f:
                        f.write(part_glb_buffer.read())

                    part_files["model/gltf-binary"] = part_glb_url
                except Exception as e:
                    print(f"Warning: Could not write 3D formats for part {fline_str}: {e}")

            parts[fline_str] = {"files": part_files}

    # Write dataset info.json
    dataset_info = {
        "id": dataset_id,
        "mime_type": "application/x-aarhusxyz-msgpack",
        "dataset_name": dataset_name,
        "files": files,
        "parts": parts
    }

    info_url = f"{dataset_prefix}/info.json"
    print(f"Writing dataset info to: {info_url}")

    with fsspec.open(info_url, 'w', **storage_kwargs) as f:
        json.dump(dataset_info, f, indent=2)

    return dataset_id
