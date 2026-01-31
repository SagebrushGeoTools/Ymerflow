"""Import process for geophysics data."""

import uuid
import json
import fsspec
import libaarhusxyz
import slugify
from .utils import localize_urls


class LibaarhusXYZImporter:
    """Import SkyTEM data from XYZ/GEX files (Aarhus Workbench format)."""

    @classmethod
    def schema(cls):
        """Return JSON Schema for import parameters."""
        return {
            "type": "object",
            "properties": {
                "xyzfile": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "upload",
                    "title": "XYZ Data File",
                    "description": "The data file (.xyz)",
                    "pattern": "\\.xyz$"
                },
                "gexfile": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "upload",
                    "title": "GEX System File",
                    "description": "System description / calibration file (.gex)",
                    "pattern": "\\.gex$"
                },
                "alcfile": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "upload",
                    "title": "ALC Allocation File (Optional)",
                    "description": "Column name mapping file (.alc)",
                    "pattern": "\\.alc$"
                },
                "scalefactor": {
                    "type": "number",
                    "title": "Scale Factor",
                    "description": "Data unit: 1 = volt, 1e-12 = picovolt",
                    "default": 1e-12
                },
                "projection": {
                    "type": "integer",
                    "title": "EPSG Projection Code",
                    "description": "EPSG code for the projection and chart datum of sounding locations",
                    "format": "x-epsg",
                    "minimum": 1
                }
            },
            "required": ["xyzfile", "gexfile", "scalefactor", "projection"]
        }

    @classmethod
    def run(cls, storage_context=None, **kwargs):
        """Import data and write output datasets.

        Args:
            storage_context: Dict with process_id, storage_base, storage_kwargs
            **kwargs: Process parameters from schema (xyzfile, gexfile, alcfile, scalefactor, projection)

        Returns:
            Dict with status and outputs
        """
        print("Running import...")
        print(f"Parameters: {kwargs}")

        if not storage_context:
            raise ValueError("storage_context is required")

        process_id = storage_context['process_id']
        storage_base = storage_context['storage_base']
        storage_kwargs = storage_context['storage_kwargs']

        # Extract parameters
        xyzfile = kwargs.get("xyzfile")
        gexfile = kwargs.get("gexfile")
        alcfile = kwargs.get("alcfile")
        scalefactor = kwargs.get("scalefactor", 1e-12)
        projection = kwargs.get("projection")

        # Validate required parameters
        assert xyzfile is not None, "Missing xyz file"
        assert gexfile is not None, "Missing gex file"
        assert isinstance(projection, int) and projection > 0, \
            "Invalid projection, please provide a valid EPSG projection code"
        assert isinstance(scalefactor, (int, float)) and scalefactor != 0, \
            "Invalid scalefactor, please provide a valid scalefactor"

        # Localize URLs to local files
        file_params = {
            "xyzfile": xyzfile,
            "gexfile": gexfile,
            "alcfile": alcfile
        }

        with localize_urls(file_params, storage_kwargs) as localized_files:
            print("Creating survey from files...")

            # Load XYZ data
            xyz = libaarhusxyz.XYZ(
                localized_files["xyzfile"],
                alcfile=localized_files.get("alcfile")
            )

            # Set metadata
            xyz.model_info['scalefactor'] = float(scalefactor)
            xyz.model_info['projection'] = int(projection)
            xyz.normalize(naming_standard="alc")

            assert "projection" in xyz.model_info
            assert "scalefactor" in xyz.model_info

            # Load GEX (system description)
            gex = libaarhusxyz.GEX(localized_files["gexfile"])

            # Create survey
            survey = libaarhusxyz.Survey(xyz, gex)

            # Write dataset
            print("Writing imported dataset...")
            dataset_id = cls._write_dataset(
                survey,
                "imported_data",
                process_id,
                storage_base,
                storage_kwargs
            )

            outputs = {
                'imported_data': f"{storage_base}/processes/{process_id}/datasets/{dataset_id}/root.msgpack"
            }

            print("Import complete")
            return {"status": "success", "outputs": outputs}

    @classmethod
    def _write_dataset(cls, survey, dataset_name, process_id, storage_base, storage_kwargs):
        """Write a survey dataset to storage.

        Args:
            survey: libaarhusxyz.Survey instance
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
            survey.xyz.to_msgpack(f, gex=survey.gex)

        # Write root geography (GeoJSON)
        root_geojson = survey.xyz.to_geojson()
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

        if "title" in survey.xyz.flightlines.columns:
            print("Splitting by flight lines...")
            for fline, line_xyz in survey.xyz.split_by_line().items():
                fline_str = slugify.slugify(str(fline), separator="_")

                # Write part msgpack
                part_file_url = f"{dataset_prefix}/parts/{fline_str}.msgpack"
                print(f"Writing part {fline_str} to: {part_file_url}")

                with fsspec.open(part_file_url, 'wb', **storage_kwargs) as f:
                    line_xyz.to_msgpack(f, gex=survey.gex)

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
