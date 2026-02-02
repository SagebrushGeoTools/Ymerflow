"""Import process for geophysics data."""

import libaarhusxyz
from .utils import localize_urls
from .dataset_utils import write_dataset


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

            # Write dataset
            print("Writing imported dataset...")
            dataset_id = write_dataset(
                xyz,
                gex,
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
