import time
import uuid
import json
import fsspec
import pandas as pd
from nagelfluh_runner import xyz_utils


def create_mock_dataset(process_type: str, output_name: str, storage_context: dict):
    """Create a mock dataset and write to storage.

    Args:
        process_type: Type of process (fft, inversion, etc.)
        output_name: Name of output (spectrum, model, etc.)
        storage_context: Dict with process_id, storage_base, storage_kwargs

    Returns:
        Storage URL of created dataset
    """
    dataset_id = str(uuid.uuid4())
    process_id = storage_context['process_id']
    project_id = storage_context['project_id']
    storage_base = storage_context['storage_base']
    storage_kwargs = storage_context['storage_kwargs']

    # Create XYZ dataset with msgpack format
    xyz_data = xyz_utils.create_mock_xyz(process_type=process_type)
    msgpack_data = xyz_utils.xyz_to_msgpack(xyz_data)

    # Store root part data
    root_file_url = f"{storage_base}/processes/{process_id}/datasets/{dataset_id}/root.msgpack"
    print(f"Writing msgpack dataset to: {root_file_url}")

    with fsspec.open(root_file_url, 'wb', **storage_kwargs) as f:
        f.write(msgpack_data)

    # Generate and store root part geography (GeoJSON)
    root_geojson = xyz_utils.xyz_to_geojson(xyz_data)
    for feature in root_geojson["features"]:
        feature["properties"]["dataset_id"] = dataset_id

    root_geography_url = f"{storage_base}/processes/{process_id}/datasets/{dataset_id}/root.geojson"
    print(f"Writing geography to: {root_geography_url}")

    with fsspec.open(root_geography_url, 'w', **storage_kwargs) as f:
        json.dump(root_geojson, f)

    # Add additional parts from unique values in "title" column
    if "title" in xyz_data["xyz"].flightlines.columns:
        unique_titles = xyz_data["xyz"].flightlines["title"].unique()
        for title in unique_titles:
            # Convert numpy types to Python native types for JSON serialization
            title_str = str(title) if pd.notna(title) else "unknown"
            part_file_url = f"{storage_base}/processes/{process_id}/datasets/{dataset_id}/parts/{title_str}.msgpack"

            # Extract and save part data
            part_xyz = xyz_utils.extract_xyz_part(xyz_data, title_str)
            if part_xyz:
                part_msgpack = xyz_utils.xyz_to_msgpack(part_xyz)
                print(f"Writing part msgpack to: {part_file_url}")

                with fsspec.open(part_file_url, 'wb', **storage_kwargs) as f:
                    f.write(part_msgpack)

                # Generate and store part geography (GeoJSON)
                part_geojson = xyz_utils.xyz_to_geojson(part_xyz, part_path=title_str)
                for feature in part_geojson["features"]:
                    feature["properties"]["dataset_id"] = dataset_id

                part_geography_url = f"{storage_base}/processes/{process_id}/datasets/{dataset_id}/parts/{title_str}.geojson"
                print(f"Writing part geography to: {part_geography_url}")

                with fsspec.open(part_geography_url, 'w', **storage_kwargs) as f:
                    json.dump(part_geojson, f)

    print(f"Dataset written successfully: {dataset_id}")
    return root_file_url


def run_fft(storage_context=None, **kwargs):
    """Fake FFT process that writes output datasets."""
    print("Running FFT...")
    print(f"Parameters: {kwargs}")

    time.sleep(5)

    # Create output datasets
    outputs = {}
    if storage_context:
        outputs['spectrum'] = create_mock_dataset('fft', 'spectrum', storage_context)
        outputs['processed'] = create_mock_dataset('fft', 'processed', storage_context)

    print("FFT complete")
    return {"status": "success", "outputs": outputs}


def run_inversion(storage_context=None, **kwargs):
    """Fake inversion process that writes output datasets."""
    print("Running inversion...")
    print(f"Parameters: {kwargs}")

    time.sleep(10)

    # Create output datasets
    outputs = {}
    if storage_context:
        outputs['model'] = create_mock_dataset('inversion', 'model', storage_context)
        outputs['residuals'] = create_mock_dataset('inversion', 'residuals', storage_context)

    print("Inversion complete")
    return {"status": "success", "outputs": outputs}


def run_import_data(storage_context=None, **kwargs):
    """Import data process that reads from uploads and writes datasets."""
    print("Running import_data...")
    print(f"Parameters: {kwargs}")

    # In a real implementation, would read from kwargs['data_file'] (upload URL)
    # and convert to dataset format

    time.sleep(3)

    # Create output dataset
    outputs = {}
    if storage_context:
        outputs['imported_data'] = create_mock_dataset('import_data', 'imported_data', storage_context)

    print("Import complete")
    return {"status": "success", "outputs": outputs}


def run_create_environment(storage_context=None, **kwargs):
    """Fake environment creation."""
    print("Creating environment...")
    print(f"Parameters: {kwargs}")

    time.sleep(15)

    print("Environment created")
    return {"status": "success"}
