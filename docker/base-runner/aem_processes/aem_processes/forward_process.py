"""Forward modelling process for electromagnetic data."""

import json
import fsspec
import libaarhusxyz
import libaarhusxyz.export.msgpack
import numpy as np
import swaggerspect
import SimPEG
import SimPEG.directives
from .utils import get_entry_points, load_system, localize_urls
from .dataset_utils import write_dataset
import swaggerspect.validate
import copy


class Forward:
    """Run forward modelling for electromagnetic data.

    Takes a resistivity model as input and generates synthetic AEM responses.
    """

    @classmethod
    def system_schema(cls):
        return swaggerspect.swagger_to_json_schema(
            swaggerspect.get_apis("simpeg.static_instrument"),
            multi=False
        )

    @classmethod
    def schema(cls):
        """Return JSON Schema for forward modelling parameters.

        Dynamically generates schema from available systems.
        """

        return {
            "type": "object",
            "properties": {
                "input_model": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "dataset",
                    "title": "Input Resistivity Model",
                    "description": "Resistivity model dataset to forward model (from inversion or model simulator)"
                },
                "system": cls.system_schema(),
            },
            "required": ["input_model", "system"]
        }

    @classmethod
    def run(cls, storage_context=None, **kwargs):
        """Run forward modelling and write output dataset.

        Args:
            storage_context: Dict with process_id, storage_base, storage_kwargs
            **kwargs: Process parameters from schema

        Returns:
            Dict with status and outputs
        """
        print("Running forward modelling...")
        print(f"Parameters: {kwargs}")

        if not storage_context:
            raise ValueError("storage_context is required")

        process_id = storage_context['process_id']
        storage_base = storage_context['storage_base']
        storage_kwargs = storage_context['storage_kwargs']

        # Get input model URL
        input_model_url = kwargs.get('input_model')
        if not input_model_url:
            raise ValueError("input_model is required")

        # Get system configuration
        system_config = kwargs.get('system', {})
        if not system_config:
            raise ValueError("system configuration is required")

        # Transform system_config from swaggerspect format to load_system format
        # swaggerspect produces: {"system_name": {"param1": val1, ...}}
        # load_system expects: {"name": "system_name", "args": {"param1": val1, ...}}

        system_config = copy.deepcopy(system_config)
        swaggerspect.validate.GroupMergingValidator(
            cls.system_schema()
        ).validate(
            system_config
        )

        system_name, system_args = next(iter(system_config.items()))
        system_config = {"name": system_name, "args": system_args}

        # Track outputs
        outputs = {}

        # Localize input model URL
        print(f"Loading input model from: {input_model_url}")
        with localize_urls({'input': input_model_url}, storage_kwargs) as localized:
            input_path = localized['input']

            xyz, gex = libaarhusxyz.export.msgpack.load(input_path, True)
            xyz.normalize(naming_standard="libaarhusxyz")

            # Verify this is a resistivity model (has layer_data)
            if not hasattr(xyz, 'layer_data') or not xyz.layer_data:
                raise ValueError(
                    "Input dataset does not appear to be a resistivity model. "
                    "Forward modelling requires a dataset with layer_data (resistivity values). "
                    "Expected input: output from inversion or resistivity model simulator. "
                    "If you have raw AEM data, use the inversion process instead."
                )

            print(f"Loading forward modelling system: {system_config.get('name')}")
            with load_system(system_config, storage_kwargs) as SystemClass:
                CalibratedSystem = SystemClass.load_gex(gex)

                # Create forward modelling instance
                print("Creating forward modelling system...")
                forward_system = CalibratedSystem(xyz)

                # Run forward modelling
                print("Running forward modelling...")
                synthetic_data = forward_system.forward()

                # Collect output dataset (synthetic data)
                print("Collecting results...")
                synthetic_data.normalize(naming_standard="alc")

                # Write synthetic data output
                print("Writing synthetic_data...")
                dataset_id = write_dataset(
                    synthetic_data,
                    gex,
                    "synthetic_data",
                    process_id,
                    storage_base,
                    storage_kwargs
                )
                outputs["synthetic_data"] = f"{storage_base}/processes/{process_id}/datasets/{dataset_id}/root.msgpack"

                print("Forward modelling complete")
                return {"status": "success", "outputs": outputs}
