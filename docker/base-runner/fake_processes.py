import time
import uuid
import json
import fsspec


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
    storage_base = storage_context['storage_base']
    storage_kwargs = storage_context['storage_kwargs']

    # Create mock data
    mock_data = {
        "type": process_type,
        "output_name": output_name,
        "dataset_id": dataset_id,
        "data": [1, 2, 3, 4, 5]  # Fake data
    }

    # Write to storage
    dataset_url = f"{storage_base}/processes/{process_id}/datasets/{dataset_id}/root.msgpack"
    print(f"Writing dataset to: {dataset_url}")

    with fsspec.open(dataset_url, 'w', **storage_kwargs) as f:
        json.dump(mock_data, f)

    print(f"Dataset written successfully: {dataset_id}")
    return dataset_url


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
