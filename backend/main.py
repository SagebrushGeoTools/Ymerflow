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

@app.get("/process-types")
def get_process_types():
    return PROCESS_TYPES

@app.post("/process")
def create_process(proc: Dict[str, Any]):
    pid = str(uuid.uuid4())
    proc["id"] = pid
    proc["version"] = 1
    proc["state"] = "done"  # Immediately mark as done for demo

    # Create output datasets
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
            "process_name": proc.get("name", f"{proc['type']}-process"),
            "process_version": proc["version"],
            "dataset_name": output_name
        }

        DATASETS[dataset_id] = dataset
        outputs[output_name] = f"http://localhost:8000/dataset/{dataset_id}"

    proc["outputs"] = outputs
    PROCESSES[pid] = proc
    return proc

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

        # Filter by process state if required
        if completed_only and process.get("state") != "done":
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
