from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Any, Optional
import uuid
import random

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

        # Generate mock data
        x = [i for i in range(100)]
        y = [random.random() for _ in range(100)]

        dataset = {
            "id": dataset_id,
            "mime_type": "application/json",
            "content": {
                "x": x,
                "y": y,
                "x_unit": "s",
                "y_unit": "V"
            },
            "process_id": pid,
            "process_name": PROCESSES[pid]["name"],
            "process_version": new_version,
            "dataset_name": output_name
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
