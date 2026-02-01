"""Processing process for geophysics data."""

import uuid
import json
import fsspec
import libaarhusxyz
import numpy as np
import slugify
import swaggerspect
from .utils import get_entry_points, load_fn, localize_urls


class Processing:
    """Apply data processing steps to imported survey data."""

    @classmethod
    def schema(cls):
        """Return JSON Schema for processing parameters.

        Dynamically generates schema from available processing steps.
        """
        # Get available processing steps
        try:
            steps_schema = swaggerspect.swagger_to_json_schema(
                swaggerspect.get_apis("emeraldprocessing.pipeline_step"),
                multi=True  # Allow multiple steps
            )
        except Exception as e:
            # Fallback if swaggerspect fails or no steps available
            steps_schema = {
                "type": "array",
                "title": "Processing Steps",
                "description": "Sequence of processing steps to apply",
                "items": {
                    "type": "object"
                }
            }

        return {
            "type": "object",
            "properties": {
                "input_data": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "dataset",
                    "title": "Input Dataset",
                    "description": "Dataset from import or previous processing"
                },
                "steps": steps_schema
            },
            "required": ["input_data"]
        }

    @classmethod
    def run(cls, storage_context=None, **kwargs):
        """Process data and write output datasets.

        Args:
            storage_context: Dict with process_id, storage_base, storage_kwargs
            **kwargs: Process parameters from schema

        Returns:
            Dict with status and outputs
        """
        print("Running processing...")
        print(f"Parameters: {kwargs}")

        if not storage_context:
            raise ValueError("storage_context is required")

        process_id = storage_context['process_id']
        storage_base = storage_context['storage_base']
        storage_kwargs = storage_context['storage_kwargs']

        # Localize all URLs in kwargs
        with localize_urls(kwargs, storage_kwargs) as localized_kwargs:
            # Get input dataset path (now localized)
            input_data_path = localized_kwargs.get('input_data')
            if not input_data_path:
                raise ValueError("input_data is required")

            # Get processing steps (now localized)
            steps = localized_kwargs.get('steps', [])

            # Use default data loader
            data_loader_name = 'emeraldprocessing.pipeline.ProcessingData'

            # Load XYZ and GEX data once
            print(f"Loading input data from: {input_data_path}")
            xyz, gex = libaarhusxyz.export.msgpack.load(input_data_path, True)
            xyz.normalize(naming_standard="alc")

            # Create ProcessingData instance with xyz and gex objects directly
            print(f"Creating data loader: {data_loader_name}")
            ProcessingDataClass = load_fn(data_loader_name)

            # Note: ProcessingData expects outdir for temporary files
            import tempfile
            with tempfile.TemporaryDirectory() as tempdir:
                data = ProcessingDataClass(
                    outdir=tempdir,
                    data=xyz,
                    system_data=gex
                )

                # Store original data for reference
                data.orig_xyz = xyz
                data.orig_xyz_by_line = xyz.split_by_line()

                # Apply processing steps (already localized)
                if steps:
                    print(f"Applying {len(steps)} processing step(s)...")
                    data.process(steps)
                else:
                    print("No processing steps specified, passing through data")

                # Add inversion-ready columns (num_* fields for inuse keys)
                print("Adding inversion-ready columns...")
                try:
                    from emeraldprocessing.tem.data_keys import inuse_key_prefix

                    for key in data.xyz.layer_data.keys():
                        if inuse_key_prefix in key:
                            if '_' not in key.split(inuse_key_prefix)[0]:
                                col_name = f"num_{key}"
                                data.xyz.flightlines[col_name] = np.abs(
                                    data.xyz.layer_data[key]
                                ).sum(axis=1, skipna=True)
                except ImportError:
                    print("Warning: emeraldprocessing not available, skipping inversion columns")

                # Write processed dataset
                print("Writing processed dataset...")
                dataset_id = cls._write_dataset(
                    data.xyz,
                    gex,
                    "processed_data",
                    process_id,
                    storage_base,
                    storage_kwargs
                )

                outputs = {
                    'processed_data': f"{storage_base}/processes/{process_id}/datasets/{dataset_id}/root.msgpack"
                }

                print("Processing complete")
                return {"status": "success", "outputs": outputs}

    @classmethod
    def _write_dataset(cls, xyz, gex, dataset_name, process_id, storage_base, storage_kwargs):
        """Write a processed dataset to storage.

        Args:
            xyz: libaarhusxyz.XYZ instance
            gex: libaarhusxyz.GEX instance
            dataset_name: Name for this dataset
            process_id: Process ID
            storage_base: Storage base URL
            storage_kwargs: fsspec storage arguments

        Returns:
            Dataset ID
        """
        dataset_id = str(uuid.uuid4())
        dataset_prefix = f"{storage_base}/processes/{process_id}/datasets/{dataset_id}"

        # Write root msgpack
        root_file_url = f"{dataset_prefix}/root.msgpack"
        print(f"Writing msgpack to: {root_file_url}")

        with fsspec.open(root_file_url, 'wb', **storage_kwargs) as f:
            xyz.to_msgpack(f, gex=gex)

        # Write root geography (GeoJSON)
        root_geojson = xyz.to_geojson()
        for feature in root_geojson.get("features", []):
            if "properties" not in feature:
                feature["properties"] = {}
            feature["properties"]["dataset_id"] = dataset_id

        root_geography_url = f"{dataset_prefix}/root.geojson"
        print(f"Writing geography to: {root_geography_url}")

        with fsspec.open(root_geography_url, 'w', **storage_kwargs) as f:
            json.dump(root_geojson, f)

        # Split by flight lines and write parts
        parts = {"": {"file_url": root_file_url, "mime_type": "application/x-aarhusxyz-msgpack", "geography_url": root_geography_url}}

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
                part_geojson = line_xyz.to_geojson()
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
