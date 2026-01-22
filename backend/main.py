from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Any
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
                "regularization": {"type": "number", "default": 0.1},
                "max_iter": {"type": "integer", "default": 50}
            }
        }
    }
}

PROCESSES = {}

@app.get("/process-types")
def get_process_types():
    return PROCESS_TYPES

@app.post("/process")
def create_process(proc: Dict[str, Any]):
    pid = str(uuid.uuid4())
    proc["id"] = pid
    proc["version"] = 1
    proc["state"] = "queued"
    PROCESSES[pid] = proc
    return proc

@app.get("/processes")
def list_processes():
    return list(PROCESSES.values())

@app.get("/datasets/{process_id}")
def get_datasets(process_id: str):
    # Mock numeric data
    x = [i for i in range(100)]
    y = [random.random() for _ in range(100)]
    return {
        "name": f"output-{process_id[:6]}",
        "x": x,
        "y": y,
        "x_unit": "s",
        "y_unit": "V"
    }
