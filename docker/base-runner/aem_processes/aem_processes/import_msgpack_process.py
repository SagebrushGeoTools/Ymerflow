"""Import process for XYZ msgpack containers (e.g., from Nagelfluh AEM Model Simulator)."""

import libaarhusxyz
from .utils import localize_urls
from .dataset_utils import write_dataset


class MsgpackImporter:
    """Import AEM data from XYZ msgpack container with embedded GEX."""

    @classmethod
    def schema(cls):
        """Return JSON Schema for import parameters."""
        return {
            "type": "object",
            "properties": {
                "msgpack_file": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "upload",
                    "title": "XYZ Msgpack File",
                    "description": "XYZ msgpack container with embedded GEX data (.xyz or .msgpack)",
                    "pattern": "\\.(xyz|msgpack)$"
                }
            },
            "required": ["msgpack_file"]
        }

    @classmethod
    def run(cls, storage_context=None, **kwargs):
        """Import msgpack data and write output dataset.

        Args:
            storage_context: Dict with process_id, storage_base, storage_kwargs
            **kwargs: Process parameters from schema (msgpack_file)

        Returns:
            Dict with status and outputs
        """
        print("Running msgpack import...")
        print(f"Parameters: {kwargs}")

        if not storage_context:
            raise ValueError("storage_context is required")

        process_id = storage_context['process_id']
        storage_base = storage_context['storage_base']
        storage_kwargs = storage_context['storage_kwargs']

        # Extract parameters
        msgpack_file = kwargs.get("msgpack_file")

        # Validate required parameters
        assert msgpack_file is not None, "Missing msgpack file"

        # Localize URLs to local files
        file_params = {
            "msgpack_file": msgpack_file
        }

        with localize_urls(file_params, storage_kwargs) as localized_files:
            print("Loading XYZ msgpack container...")

            # Load XYZ msgpack (contains both data and GEX)
            xyz = libaarhusxyz.XYZ(localized_files["msgpack_file"])

            # Validate that the msgpack contains required data
            assert hasattr(xyz, 'flightlines'), "Invalid msgpack: missing flightlines data"

            # Check for projection in model_info
            if 'projection' not in xyz.model_info:
                print("Warning: No projection found in msgpack, data may not have CRS information")

            # Try to normalize column names (may not be needed for files from Model Simulator)
            # This is safe to call - it only renames columns if they match known patterns
            try:
                xyz.normalize(naming_standard="alc")
                print("Normalized column names to ALC standard")
            except Exception as e:
                print(f"Could not normalize column names: {e}")
                print("Continuing without normalization (may be OK for resistivity models)")

            # Extract GEX from the XYZ object (it should be embedded)
            # The GEX data is stored in xyz.system
            gex = None
            if hasattr(xyz, 'system') and xyz.system:
                print("Found embedded GEX/system data in msgpack")
                # Create a GEX object from the embedded system data
                gex = libaarhusxyz.GEX()
                gex.data = xyz.system
            else:
                print("Warning: No GEX/system data found in msgpack")
                # Create empty GEX for compatibility
                gex = libaarhusxyz.GEX()

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

            print("Msgpack import complete")
            return {"status": "success", "outputs": outputs}
