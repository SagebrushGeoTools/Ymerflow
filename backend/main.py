from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Any, Optional
import uuid
import random
import numpy as np
import pandas as pd
import libaarhusxyz
import msgpack
import msgpack_numpy as m
import io

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

PROCESS_TYPES = {
    "fft": {
        "schema": {
            "type": "object",
            "properties": {
                "input_signal": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "dataset",
                    "title": "Input Signal"
                },
                "window": {"type": "number", "default": 1.0},
                "overlap": {"type": "number", "default": 0.5}
            },
            "required": ["window"]
        }
    },
    "inversion": {
        "schema": {
            "type": "object",
            "properties": {
                "input_data": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "dataset",
                    "title": "Input Dataset"
                },
                "regularization": {"type": "number", "default": 0.1},
                "max_iter": {"type": "integer", "default": 50}
            }
        }
    }
}

PROCESSES = {}
DATASETS = {}
DATASET_DATA = {}  # Stores actual data for datasets and parts
XYZ_OBJECTS = {}   # Stores libaarhusxyz.XYZ objects for xyz datasets

def create_mock_xyz():
    """Create a mock libaarhusxyz.XYZ object with synthetic data"""
    # Create mock flightlines data (main DataFrame)
    n_soundings = 100
    flightlines_data = {
        "lat": np.linspace(55.0, 56.0, n_soundings),
        "lon": np.linspace(9.0, 10.0, n_soundings),
        "elevation": np.random.uniform(0, 50, n_soundings),
        "line_no": np.repeat([1, 2], [50, 50]),
        "timestamp": np.arange(n_soundings, dtype=float),
    }

    # Create mock layer data (channels)
    n_layers = 20
    layer_data = {}

    # Channel 1
    layer_data["channel_1"] = {
        "depth": np.tile(np.linspace(0, 100, n_layers), (n_soundings, 1)).flatten(),
        "values": np.random.uniform(10, 100, n_soundings * n_layers),
        "resistivity": np.random.uniform(10, 1000, n_soundings * n_layers),
    }

    # Channel 2
    layer_data["channel_2"] = {
        "depth": np.tile(np.linspace(0, 50, n_layers), (n_soundings, 1)).flatten(),
        "values": np.random.uniform(5, 50, n_soundings * n_layers),
        "conductivity": np.random.uniform(0.001, 0.1, n_soundings * n_layers),
    }

    # Create XYZ object manually (since we can't read from file)
    # We'll store the data in the format expected by the msgpack export
    xyz_data = {
        "model_info": {
            "source": "mock_synthetic",
            "created": "backend"
        },
        "flightlines": flightlines_data,
        "layer_data": layer_data
    }

    return xyz_data

def xyz_to_msgpack(xyz_data):
    """Convert XYZ data dict to msgpack binary"""
    return msgpack.packb(xyz_data, default=m.encode, use_bin_type=True)

def extract_xyz_part(xyz_data, part_name):
    """Extract a single channel from XYZ data"""
    if part_name in xyz_data["layer_data"]:
        return {
            "model_info": xyz_data["model_info"],
            "flightlines": xyz_data["flightlines"],
            "layer_data": {
                part_name: xyz_data["layer_data"][part_name]
            }
        }
    return None

def extract_dependencies(params):
    """Extract dataset URLs from params and build dependency list"""
    dependencies = []

    def find_dataset_urls(obj, path=""):
        """Recursively find dataset URLs in nested structures"""
        if isinstance(obj, str):
            if obj.startswith("http://localhost:8000/dataset/"):
                dataset_id = obj.split("/")[-1]
                dataset = DATASETS.get(dataset_id)
                if dataset:
                    dependencies.append({
                        "source_process_id": dataset["process_id"],
                        "source_process_version": dataset["process_version"],
                        "source_dataset_name": dataset["dataset_name"],
                        "target_param_name": path
                    })
        elif isinstance(obj, dict):
            for key, value in obj.items():
                new_path = f"{path}.{key}" if path else key
                find_dataset_urls(value, new_path)
        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                new_path = f"{path}[{i}]"
                find_dataset_urls(item, new_path)

    find_dataset_urls(params)
    return dependencies

@app.get("/process-types")
def get_process_types():
    return PROCESS_TYPES

@app.post("/process")
def create_process(proc: Dict[str, Any]):
    # Check if this is a new version of an existing process
    existing_id = proc.get("id")

    if existing_id and existing_id in PROCESSES:
        # Adding new version to existing process
        pid = existing_id
        existing_process = PROCESSES[pid]
        new_version = len(existing_process["versions"]) + 1
    else:
        # Creating new process
        pid = str(uuid.uuid4())
        new_version = 1
        PROCESSES[pid] = {
            "id": pid,
            "name": proc.get("name", f"{proc['type']}-process"),
            "type": proc["type"],
            "versions": []
        }

    # Create output datasets for this version
    outputs = {}
    output_names = ["output", "processed"]  # Default output names

    for output_name in output_names:
        dataset_id = str(uuid.uuid4())

        # Create XYZ dataset with msgpack format
        xyz_data = create_mock_xyz()
        XYZ_OBJECTS[dataset_id] = xyz_data

        # Create parts structure from layer_data channels
        parts = {}
        for channel_name in xyz_data["layer_data"].keys():
            parts[channel_name] = {
                "mime_type": "application/x-aarhusxyz-msgpack"
            }

        dataset = {
            "id": dataset_id,
            "mime_type": "application/x-aarhusxyz-msgpack",
            "process_id": pid,
            "process_name": PROCESSES[pid]["name"],
            "process_version": new_version,
            "dataset_name": output_name,
            "parts": parts
        }

        DATASETS[dataset_id] = dataset
        outputs[output_name] = f"http://localhost:8000/dataset/{dataset_id}"

    # Create version object
    version_obj = {
        "version": new_version,
        "parameters": proc.get("params", {}),
        "outputs": outputs,
        "state": "done",  # Immediately mark as done for demo
        "dependencies": extract_dependencies(proc.get("params", {}))
    }

    PROCESSES[pid]["versions"].append(version_obj)

    # Return process with new version
    return PROCESSES[pid]

@app.get("/processes")
def list_processes():
    return list(PROCESSES.values())

@app.get("/datasets")
def search_datasets(search: str = "", completed_only: bool = True):
    """Search datasets by process name or dataset name"""
    results = []

    for dataset_id, dataset in DATASETS.items():
        process = PROCESSES.get(dataset["process_id"])
        if not process:
            continue

        # Find the version this dataset belongs to
        version_obj = None
        if process.get("versions"):
            for v in process["versions"]:
                if v["version"] == dataset["process_version"]:
                    version_obj = v
                    break

        # Filter by version state if required
        if completed_only and (not version_obj or version_obj.get("state") != "done"):
            continue

        # Filter by search string
        search_lower = search.lower()
        if search_lower:
            if search_lower not in dataset["process_name"].lower() and \
               search_lower not in dataset["dataset_name"].lower():
                continue

        results.append({
            "process_name": dataset["process_name"],
            "process_version": dataset["process_version"],
            "dataset_name": dataset["dataset_name"],
            "url": f"http://localhost:8000/dataset/{dataset_id}"
        })

    return results

@app.get("/dataset/{dataset_id}")
def get_dataset(dataset_id: str):
    """Get full dataset by ID"""
    dataset = DATASETS.get(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset

@app.get("/dataset/{dataset_id}/data")
def get_dataset_data(dataset_id: str):
    """Get data for a dataset (root level - all parts combined)"""
    if dataset_id not in DATASETS:
        raise HTTPException(status_code=404, detail="Dataset not found")

    dataset = DATASETS[dataset_id]

    # Handle XYZ datasets
    if dataset["mime_type"] == "application/x-aarhusxyz-msgpack":
        xyz_data = XYZ_OBJECTS.get(dataset_id)
        if not xyz_data:
            raise HTTPException(status_code=404, detail="Dataset data not found")

        binary = xyz_to_msgpack(xyz_data)
        return Response(content=binary, media_type="application/x-aarhusxyz-msgpack")

    # Handle JSON datasets (old format)
    data = DATASET_DATA.get(dataset_id)
    if not data:
        raise HTTPException(status_code=404, detail="Dataset data not found")

    return data

@app.get("/dataset/{dataset_id}/geography")
def get_dataset_geography(dataset_id: str):
    """Get GeoJSON geography for a dataset"""
    if dataset_id not in DATASETS:
        raise HTTPException(status_code=404, detail="Dataset not found")

    dataset = DATASETS[dataset_id]
    features = []

    # Handle XYZ datasets - derive geography from flightlines
    if dataset["mime_type"] == "application/x-aarhusxyz-msgpack":
        xyz_data = XYZ_OBJECTS.get(dataset_id)
        if xyz_data and "flightlines" in xyz_data:
            flightlines = xyz_data["flightlines"]
            lats = flightlines.get("lat", [])
            lons = flightlines.get("lon", [])

            # Create a point for each sounding, labeled by part (all parts)
            # Since this is "all", we'll mark each point with "all"
            for i in range(len(lats)):
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [float(lons[i]), float(lats[i])]
                    },
                    "properties": {
                        "sounding_index": i,
                        "part": "all"
                    }
                })
    else:
        # Handle JSON datasets - generate mock GeoJSON
        if dataset.get("parts"):
            for part_name in dataset["parts"].keys():
                for i in range(2):
                    features.append({
                        "type": "Feature",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [random.uniform(-180, 180), random.uniform(-90, 90)]
                        },
                        "properties": {
                            "name": f"{part_name} Point {i+1}",
                            "part": part_name
                        }
                    })

    return {
        "type": "FeatureCollection",
        "features": features
    }

@app.get("/dataset/{dataset_id}/{part_path:path}/data")
def get_dataset_part_data(dataset_id: str, part_path: str):
    """Get data for a specific part of a dataset"""
    if dataset_id not in DATASETS:
        raise HTTPException(status_code=404, detail="Dataset not found")

    dataset = DATASETS[dataset_id]

    # Handle XYZ datasets
    if dataset["mime_type"] == "application/x-aarhusxyz-msgpack":
        xyz_data = XYZ_OBJECTS.get(dataset_id)
        if not xyz_data:
            raise HTTPException(status_code=404, detail="Dataset data not found")

        part_data = extract_xyz_part(xyz_data, part_path)
        if not part_data:
            raise HTTPException(status_code=404, detail="Part not found")

        binary = xyz_to_msgpack(part_data)
        return Response(content=binary, media_type="application/x-aarhusxyz-msgpack")

    # Handle JSON datasets (old format)
    data_key = f"{dataset_id}/{part_path}"
    data = DATASET_DATA.get(data_key)
    if not data:
        raise HTTPException(status_code=404, detail="Part data not found")

    return data

@app.get("/dataset/{dataset_id}/{part_path:path}/geography")
def get_dataset_part_geography(dataset_id: str, part_path: str):
    """Get GeoJSON geography for a specific part of a dataset"""
    if dataset_id not in DATASETS:
        raise HTTPException(status_code=404, detail="Dataset not found")

    dataset = DATASETS[dataset_id]
    features = []

    # Handle XYZ datasets - flightlines are shared, label with part
    if dataset["mime_type"] == "application/x-aarhusxyz-msgpack":
        xyz_data = XYZ_OBJECTS.get(dataset_id)
        if xyz_data and "flightlines" in xyz_data:
            flightlines = xyz_data["flightlines"]
            lats = flightlines.get("lat", [])
            lons = flightlines.get("lon", [])

            # Verify the part exists
            if part_path not in xyz_data.get("layer_data", {}):
                raise HTTPException(status_code=404, detail="Part not found")

            # Return all flightline points labeled with this part
            for i in range(len(lats)):
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [float(lons[i]), float(lats[i])]
                    },
                    "properties": {
                        "sounding_index": i,
                        "part": part_path
                    }
                })
    else:
        # Handle JSON datasets - generate mock GeoJSON
        for i in range(2):
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [random.uniform(-180, 180), random.uniform(-90, 90)]
                },
                "properties": {
                    "name": f"{part_path} Point {i+1}"
                }
            })

    return {
        "type": "FeatureCollection",
        "features": features
    }
