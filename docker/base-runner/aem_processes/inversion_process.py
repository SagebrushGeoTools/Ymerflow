"""Inversion process for electromagnetic data."""

import uuid
import json
import fsspec
import libaarhusxyz
import numpy as np
import pandas as pd
import slugify
import swaggerspect
from .utils import get_entry_points, load_system, localize_urls


class Inversion:
    """Run 3D electromagnetic inversions (TEM data)."""

    @classmethod
    def schema(cls):
        """Return JSON Schema for inversion parameters.

        Dynamically generates schema from available inversion systems.
        """
        # Get available inversion systems
        try:
            inversion_schema = swaggerspect.swagger_to_json_schema(
                swaggerspect.get_apis("simpeg.static_instrument"),
                multi=False
            )

            # Add save_iterations flag to all systems (same as introspect.py)
            for system in inversion_schema.get("anyOf", []):
                props = next(iter(system.get("properties", {}).values()), {})
                if "properties" in props:
                    props["properties"]["save_iterations"] = {
                        "type": "boolean",
                        "default": False,
                        "description": "Save intermediate models and synthetic data for every inversion iteration"
                    }

        except Exception as e:
            # Fallback if swaggerspect fails
            systems = get_entry_points("simpeg.static_instrument")
            inversion_schema = {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "enum": list(systems.keys()) if systems else ["None available"],
                        "title": "Inversion System"
                    },
                    "args": {
                        "type": "object",
                        "title": "System Arguments",
                        "properties": {
                            "save_iterations": {
                                "type": "boolean",
                                "default": False,
                                "description": "Save intermediate models and synthetic data for every inversion iteration"
                            }
                        }
                    }
                },
                "required": ["name"]
            }

        return {
            "type": "object",
            "properties": {
                "input_data": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "dataset",
                    "title": "Input Dataset",
                    "description": "Processed dataset to invert"
                },
                "system": inversion_schema
            },
            "required": ["input_data", "system"]
        }

    @classmethod
    def run(cls, storage_context=None, **kwargs):
        """Run inversion and write output datasets.

        Args:
            storage_context: Dict with process_id, storage_base, storage_kwargs
            **kwargs: Process parameters from schema

        Returns:
            Dict with status and outputs
        """
        print("Running inversion...")
        print(f"Parameters: {kwargs}")

        if not storage_context:
            raise ValueError("storage_context is required")

        process_id = storage_context['process_id']
        storage_base = storage_context['storage_base']
        storage_kwargs = storage_context['storage_kwargs']

        # Get input dataset URL
        input_data_url = kwargs.get('input_data')
        if not input_data_url:
            raise ValueError("input_data is required")

        # Get system configuration
        system_config = kwargs.get('system', {})
        if not system_config:
            raise ValueError("system configuration is required")

        # Track outputs
        outputs = {}
        iteration_datasets = []

        # Localize input data URL
        print(f"Loading input data from: {input_data_url}")
        with localize_urls({'input': input_data_url}, storage_kwargs) as localized:
            input_path = localized['input']

            # Load XYZ and GEX data
            xyz, gex = libaarhusxyz.export.msgpack.load(input_path, True)
            xyz.normalize(naming_standard="alc")

            # Load inversion system
            print(f"Loading inversion system: {system_config.get('name')}")
            with load_system(system_config, storage_kwargs) as SystemClass:
                # Import SimPEG components
                try:
                    import SimPEG
                    import SimPEG.directives
                except ImportError:
                    raise ImportError("SimPEG is required for inversions. Install aem-processes[all]")

                # Import resource monitoring
                try:
                    import emerald_monitor
                    has_monitor = True
                except ImportError:
                    print("Warning: emerald_monitor not available, skipping resource monitoring")
                    has_monitor = False

                # Create custom directives for logging
                class ReportingDirective(SimPEG.directives.InversionDirective):
                    """Directive to log inversion progress."""

                    def __init__(self):
                        self.logs = []

                    def log(self, data):
                        self.logs.append(data)
                        print(f"Inversion step: {data}")

                    def calc_rmse(self, status):
                        n_data = np.sum(self.invProb.dmisfit.W.diagonal() > 0)
                        status['rmse_d'] = float(np.sqrt((status['phi_d'] * 2) / n_data))
                        status['rmse_m'] = float(np.sqrt((status['phi_m'] * 2) / n_data))
                        status['rmse_m_scaled'] = float(np.sqrt((status['phi_m_scaled'] * 2) / n_data))
                        status['rmse_total'] = float(np.sqrt(status['rmse_d']**2 + status['rmse_m_scaled']**2))

                    def endIter(self):
                        status = {
                            "step": int(self.opt.iter + 2),
                            'iter': int(self.opt.iter),
                            'beta': float(self.invProb.beta),
                            "phi_d": float(self.opt.parent.phi_d * self.opt.parent.opt.factor),
                            "phi_m": float(self.opt.parent.phi_m * self.opt.parent.opt.factor),
                            'phi_m_scaled': float(self.invProb.phi_m * self.opt.factor * self.invProb.beta),
                            "f": float(self.opt.f),
                            "|proj(x-g)-x|": float(np.linalg.norm(self.opt.projection(self.opt.xc - self.opt.g) - self.opt.xc)),
                            "status": "update"
                        }
                        self.calc_rmse(status)
                        self.log(status)

                    def initialize(self):
                        self.log({"step": 1, "status": "initialize"})

                    def finish(self):
                        self.log({"step": int(self.opt.iter + 2), "status": "end"})

                class SaveOutputEveryIteration(SimPEG.directives.InversionDirective):
                    """Directive to save intermediate models."""

                    def __init__(self, system):
                        self.system = system

                    def endIter(self):
                        # Save intermediate datasets
                        iter_num = self.opt.iter
                        system = self.system

                        try:
                            model_xyz = system.inverted_model_to_xyz(
                                system.inv.invProb.model,
                                system.inv.invProb.dmisfit.simulation.thicknesses
                            )
                            model_xyz.normalize(naming_standard="alc")

                            synthetic_xyz = system.forward_data_to_xyz(
                                system.inv.invProb.dpred,
                                inversion=True
                            )
                            synthetic_xyz.normalize(naming_standard="alc")

                            # Store for later saving
                            iteration_datasets.append({
                                'iter': iter_num,
                                'model': model_xyz,
                                'synthetic': synthetic_xyz
                            })

                        except Exception as e:
                            print(f"Warning: Failed to save iteration {iter_num}: {e}")

                # Create enhanced system class with directives
                save_iterations = system_config.get('args', {}).get('save_iterations', False)

                class PipelineSystem(SystemClass):
                    """System class with pipeline directives."""

                    def make_directives(self):
                        directives = SystemClass.make_directives(self)
                        directives += [ReportingDirective()]
                        if save_iterations:
                            directives += [SaveOutputEveryIteration(self)]
                        return directives

                # Create inversion instance
                print("Creating inversion system...")
                inversion = PipelineSystem(xyz)

                # Run inversion with resource monitoring
                print("Running inversion...")

                if has_monitor:
                    with emerald_monitor.resource_monitor() as monitor:
                        monitor.start_logging()
                        try:
                            inversion.invert()
                        finally:
                            monitor.stop_logging()

                        monitor_info = monitor.get_logs()
                        inversion_time = np.round(monitor_info.iloc[-1].elapsed_time / 60 / 60, 4)
                        print(f"Inversion time: {inversion_time} hours")
                else:
                    inversion.invert()
                    monitor_info = None

                # Collect output datasets
                print("Collecting results...")
                datasets = {
                    "processed": getattr(inversion, 'corrected', None),
                    "sparse_model": getattr(inversion, 'sparse', None),
                    "sparse_synthetic": getattr(inversion, 'sparsepred', None),
                    "smooth_model": getattr(inversion, 'l2', None),
                    "smooth_synthetic": getattr(inversion, 'l2pred', None),
                }

                # Write main datasets
                for name, dataset in datasets.items():
                    if dataset is not None:
                        print(f"Writing {name}...")
                        dataset_id = cls._write_dataset(
                            dataset,
                            gex,
                            name,
                            process_id,
                            storage_base,
                            storage_kwargs
                        )
                        outputs[name] = f"{storage_base}/processes/{process_id}/datasets/{dataset_id}/root.msgpack"

                # Write iteration datasets if save_iterations was enabled
                for iter_data in iteration_datasets:
                    iter_num = iter_data['iter']

                    # Write model
                    model_name = f"intermediate_{iter_num}_model"
                    print(f"Writing {model_name}...")
                    model_id = cls._write_dataset(
                        iter_data['model'],
                        gex,
                        model_name,
                        process_id,
                        storage_base,
                        storage_kwargs
                    )
                    outputs[model_name] = f"{storage_base}/processes/{process_id}/datasets/{model_id}/root.msgpack"

                    # Write synthetic
                    synthetic_name = f"intermediate_{iter_num}_synthetic"
                    print(f"Writing {synthetic_name}...")
                    synthetic_id = cls._write_dataset(
                        iter_data['synthetic'],
                        gex,
                        synthetic_name,
                        process_id,
                        storage_base,
                        storage_kwargs
                    )
                    outputs[synthetic_name] = f"{storage_base}/processes/{process_id}/datasets/{synthetic_id}/root.msgpack"

                # Write monitor info if available
                if monitor_info is not None:
                    monitor_url = f"{storage_base}/processes/{process_id}/monitor_info.csv"
                    print(f"Writing resource monitoring data to: {monitor_url}")
                    with fsspec.open(monitor_url, 'w', **storage_kwargs) as f:
                        monitor_info.to_csv(f)

                print("Inversion complete")
                return {"status": "success", "outputs": outputs}

    @classmethod
    def _write_dataset(cls, xyz, gex, dataset_name, process_id, storage_base, storage_kwargs):
        """Write an inverted dataset to storage.

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
