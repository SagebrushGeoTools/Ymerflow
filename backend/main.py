from fastapi import FastAPI, HTTPException, Response, Depends, Header, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Any, Optional, List
import uuid
import random
import numpy as np
import pandas as pd
import libaarhusxyz
import msgpack
import msgpack_numpy as m
import io
from datetime import datetime, timedelta
import jwt
import asyncio
import json

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# WebSocket connection managers
LOG_CONNECTIONS: Dict[str, List[WebSocket]] = {}  # process_id -> list of websockets
STATE_CONNECTIONS: List[WebSocket] = []  # Global state update connections

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
    },
    "import_data": {
        "schema": {
            "type": "object",
            "properties": {
                "data_file": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "upload",
                    "title": "Data File"
                },
                "file_format": {
                    "type": "string",
                    "enum": ["csv", "xyz", "json"],
                    "default": "csv",
                    "title": "File Format"
                }
            },
            "required": ["data_file"]
        }
    }
}

PROJECTS = {}
ENVIRONMENTS = {}
PROCESSES = {}
DATASETS = {}
DATASET_DATA = {}  # Stores actual data for datasets and parts
XYZ_OBJECTS = {}   # Stores libaarhusxyz.XYZ objects for xyz datasets
USERS = {}  # Stores user authentication and account data
UPLOADS = {}  # Stores uploaded files {file_id: {"filename": str, "content": bytes, "content_type": str}}
WORKSPACES = {}  # Stores saved workspace layouts {workspace_id: {"id": str, "title": str, "layout": dict, "created_at": str}}
SECRET_KEY = "fake-secret-key-for-demo"  # JWT secret (hardcoded for demo)

# Create default project
default_project_id = "default-project-00000000-0000-0000-0000-000000000000"
PROJECTS[default_project_id] = {
    "id": default_project_id,
    "name": "Default",
    "created_at": datetime.now().isoformat()
}

# Create default environment with existing process types
default_env_id = "default-environment-00000000-0000-0000-0000-000000000000"
ENVIRONMENTS[default_env_id] = {
    "id": default_env_id,
    "name": "Default Environment",
    "docker_image": "python:3.11",
    "packages": [
        {"name": "numpy", "version": "1.24.0"},
        {"name": "pandas", "version": "2.0.0"},
        {"name": "libaarhusxyz", "version": "0.1.0"}
    ],
    "process_types": PROCESS_TYPES.copy(),
    "created_at": datetime.now().isoformat()
}

# Create default workspace
WORKSPACES["default"] = {
    "id": "default",
    "title": "Default",
    "layout": {
        "splitType": "vertical",
        "id": "root",
        "widget": "VerticalSplit",
        "children": [
            {
                "id": "35501582-95b5-458e-b8ca-3a2b63413eac",
                "widget": "FlowView"
            },
            {
                "id": "794e8232-a793-4ff6-9372-3c94169a3eac",
                "widget": "TabSet",
                "children": [
                    {
                        "id": "8658b5f1-d171-49b0-8dd9-73e46b469e5d",
                        "widget": "ProcessEditor"
                    },
                    {
                        "id": "d1e9273c-c3ca-4261-b14a-55cc0e45f583",
                        "widget": "PlotView"
                    }
                ]
            }
        ]
    },
    "created_at": datetime.now().isoformat()
}

def create_mock_xyz(process_type="fft"):
    """Load actual data from files based on process type"""
    import os

    # Determine which .xyz file to load based on process type
    data_dir = "data"
    gex_file = os.path.join(data_dir, "20201231_20023_IVF_SkyTEM304_SKB.gex")

    if process_type == "fft":
        xyz_file = os.path.join(data_dir, "aem_processed_data_foothill_central_valley.measured.xyz")
    elif process_type == "inversion":
        xyz_file = os.path.join(data_dir, "aem_processed_data_foothill_central_valley.model.xyz")
    else:
        xyz_file = os.path.join(data_dir, "aem_processed_data_foothill_central_valley.measured.xyz")

    # Load XYZ and GEX
    xyz_obj = libaarhusxyz.XYZ(xyz_file)
    xyz_obj.model_info["projection"] = 32610
    xyz_obj.normalize()

    gex_obj = libaarhusxyz.GEX(gex_file)

    return {"xyz": xyz_obj, "gex": gex_obj}

def xyz_to_msgpack(xyz_data):
    """Convert XYZ to msgpack binary"""
    buffer = io.BytesIO()
    xyz_data["xyz"].to_msgpack(buffer, gex=xyz_data["gex"])
    return buffer.getvalue()

def extract_xyz_part(xyz_data, part_name):
    """Extract rows with a specific title from XYZ data"""
    xyz_obj = xyz_data["xyz"]

    if "title" not in xyz_obj.flightlines.columns:
        return None

    # Convert part_name to float if it looks like a number
    try:
        part_name_converted = float(part_name)
    except ValueError:
        part_name_converted = part_name

    # Filter by title column
    mask = xyz_obj.flightlines["title"] == part_name_converted
    if not mask.any():
        return None

    # Create new XYZ object with filtered data
    filtered_data = xyz_obj.to_dict()
    filtered_data["flightlines"] = xyz_obj.flightlines[mask]

    # Filter layer_data to match filtered flightlines
    for key in filtered_data["layer_data"]:
        filtered_data["layer_data"][key] = filtered_data["layer_data"][key][mask]

    filtered_xyz = libaarhusxyz.XYZ(filtered_data)
    return {"xyz": filtered_xyz, "gex": xyz_data["gex"]}

async def add_log_entry(process_id: str, version: int, message: str):
    """Add a log entry and broadcast to connected clients"""
    process = PROCESSES.get(process_id)
    if not process:
        return

    version_obj = None
    for v in process["versions"]:
        if v["version"] == version:
            version_obj = v
            break

    if not version_obj:
        return

    log_entry = {
        "timestamp": datetime.now().isoformat(),
        "message": message
    }

    version_obj["logs"].append(log_entry)

    # Broadcast to connected WebSocket clients
    if process_id in LOG_CONNECTIONS:
        disconnected = []
        for ws in LOG_CONNECTIONS[process_id]:
            try:
                await ws.send_json(log_entry)
            except:
                disconnected.append(ws)

        # Remove disconnected clients
        for ws in disconnected:
            LOG_CONNECTIONS[process_id].remove(ws)

async def update_process_state(process_id: str, version: int, new_state: str):
    """Update process state and broadcast to all state listeners"""
    process = PROCESSES.get(process_id)
    if not process:
        return

    version_obj = None
    for v in process["versions"]:
        if v["version"] == version:
            version_obj = v
            break

    if not version_obj:
        return

    version_obj["state"] = new_state

    # Broadcast state change to all connected clients
    state_update = {
        "process_id": process_id,
        "version": version,
        "state": new_state
    }

    print(f"📡 Broadcasting state update: {state_update} to {len(STATE_CONNECTIONS)} clients")

    disconnected = []
    for ws in STATE_CONNECTIONS:
        try:
            await ws.send_json(state_update)
            print(f"  ✓ Sent to client")
        except Exception as e:
            print(f"  ❌ Failed to send to client: {e}")
            disconnected.append(ws)

    # Remove disconnected clients
    for ws in disconnected:
        STATE_CONNECTIONS.remove(ws)

async def run_process_task(process_id: str, version: int):
    """Simulate running a process with fake log messages"""
    print(f"🚀 Starting process task: {process_id} v{version}")

    # Wait a moment to simulate queue time
    await asyncio.sleep(1)

    # Transition to running
    print(f"▶️  Process {process_id} v{version} transitioning to running")
    await update_process_state(process_id, version, "running")
    await add_log_entry(process_id, version, "Process started")

    # Simulate processing with realistic log messages
    log_messages = [
        "Initializing processing environment...",
        "Loading input datasets...",
        "Validating input parameters...",
        "Setting up computation pipeline...",
        "Processing data chunks (1/5)...",
        "Processing data chunks (2/5)...",
        "Processing data chunks (3/5)...",
        "Processing data chunks (4/5)...",
        "Processing data chunks (5/5)...",
        "Aggregating results...",
        "Generating output datasets...",
        "Process completed successfully"
    ]

    for i, msg in enumerate(log_messages):
        await asyncio.sleep(0.4)  # Simulate work
        await add_log_entry(process_id, version, msg)

    # Transition to done
    print(f"✅ Process {process_id} v{version} transitioning to done")
    await update_process_state(process_id, version, "done")

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

def create_token(username: str) -> str:
    """Create JWT token for user"""
    payload = {
        "username": username,
        "exp": datetime.utcnow() + timedelta(days=30)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")

def get_current_user(authorization: Optional[str] = Header(None)) -> str:
    """Verify JWT token and return username"""
    if not authorization:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        token = authorization.replace("Bearer ", "")
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        username = payload.get("username")
        if username not in USERS:
            raise HTTPException(status_code=401, detail="User not found")
        return username
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# Authentication endpoints
@app.post("/auth/login")
def login(credentials: Dict[str, str]):
    """Login with any username/password (fake auth)"""
    username = credentials.get("username")
    password = credentials.get("password")

    # Fake auth - accept any username/password
    if username not in USERS:
        # Create new user on first login
        USERS[username] = {
            "password": password,
            "balance": 100.0,  # Starting balance
            "preferences": {},
            "transactions": [
                {
                    "timestamp": datetime.now().isoformat(),
                    "type": "credit",
                    "description": "Welcome bonus",
                    "amount": 100.0
                }
            ]
        }

    token = create_token(username)
    user_data = {
        "username": username,
        "balance": USERS[username]["balance"]
    }

    return {"token": token, "user": user_data}

@app.post("/auth/signup")
def signup(credentials: Dict[str, str]):
    """Signup - same as login for fake auth"""
    return login(credentials)

@app.post("/auth/forgot-password")
def forgot_password(data: Dict[str, str]):
    """Fake password reset"""
    return {"message": "Password reset email sent (fake)"}

@app.get("/auth/account")
def get_account(username: str = Depends(get_current_user)):
    """Get user account information"""
    user = USERS.get(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "username": username,
        "balance": user["balance"],
        "preferences": user["preferences"],
        "transactions": user["transactions"]
    }

@app.put("/auth/account/preferences")
def update_preferences(preferences: Dict[str, Any], username: str = Depends(get_current_user)):
    """Update user preferences"""
    user = USERS.get(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user["preferences"] = preferences
    return {
        "username": username,
        "balance": user["balance"],
        "preferences": user["preferences"]
    }

@app.get("/projects")
def list_projects():
    """List all projects"""
    return list(PROJECTS.values())

@app.post("/projects")
def create_project(project: Dict[str, Any]):
    """Create a new project"""
    project_id = str(uuid.uuid4())

    new_project = {
        "id": project_id,
        "name": project.get("name", "Unnamed Project"),
        "created_at": datetime.now().isoformat()
    }

    PROJECTS[project_id] = new_project
    return new_project

@app.get("/environments")
def list_environments():
    """List all environments"""
    return list(ENVIRONMENTS.values())

@app.post("/environments")
def create_environment(env: Dict[str, Any]):
    """Create a new environment"""
    env_id = str(uuid.uuid4())

    environment = {
        "id": env_id,
        "name": env.get("name", "Unnamed Environment"),
        "docker_image": env.get("docker_image", "python:3.11"),
        "packages": env.get("packages", []),
        "process_types": env.get("process_types", {}),
        "created_at": env.get("created_at", datetime.now().isoformat())
    }

    ENVIRONMENTS[env_id] = environment
    return environment

@app.get("/environments/{env_id}/process-types")
def get_environment_process_types(env_id: str):
    """Get process types for a specific environment"""
    environment = ENVIRONMENTS.get(env_id)
    if not environment:
        raise HTTPException(status_code=404, detail="Environment not found")
    return environment["process_types"]

@app.get("/process-types")
def get_process_types():
    """Deprecated: Use /environments/{env_id}/process-types instead"""
    return PROCESS_TYPES

@app.post("/process")
async def create_process(proc: Dict[str, Any], project_id: Optional[str] = None, username: str = Depends(get_current_user)):
    # Validate project_id
    if not project_id or project_id not in PROJECTS:
        raise HTTPException(status_code=400, detail="Valid project_id is required")

    # Validate environment_id
    environment_id = proc.get("environment_id")
    if not environment_id or environment_id not in ENVIRONMENTS:
        raise HTTPException(status_code=400, detail="Valid environment_id is required")

    # Deduct cost from user balance
    PROCESS_COST = 0.10
    user = USERS.get(username)
    if user:
        if user["balance"] < PROCESS_COST:
            raise HTTPException(status_code=402, detail="Insufficient balance")

        user["balance"] -= PROCESS_COST

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
            "environment_id": environment_id,
            "project_id": project_id,
            "versions": []
        }

    # Create output datasets for this version
    outputs = {}
    output_names = ["output", "processed"]  # Default output names

    for output_name in output_names:
        dataset_id = str(uuid.uuid4())

        # Create XYZ dataset with msgpack format - pass process type
        xyz_data = create_mock_xyz(process_type=proc["type"])
        XYZ_OBJECTS[dataset_id] = xyz_data

        # Create parts structure from unique values in "title" column
        parts = {}
        if "title" in xyz_data["xyz"].flightlines.columns:
            unique_titles = xyz_data["xyz"].flightlines["title"].unique()
            for title in unique_titles:
                # Convert numpy types to Python native types for JSON serialization
                title_str = str(title) if pd.notna(title) else "unknown"
                parts[title_str] = {
                    "mime_type": "application/x-aarhusxyz-msgpack"
                }

        dataset = {
            "id": dataset_id,
            "mime_type": "application/x-aarhusxyz-msgpack",
            "process_id": pid,
            "process_name": PROCESSES[pid]["name"],
            "process_version": new_version,
            "dataset_name": output_name,
            "project_id": project_id,
            "parts": parts
        }

        DATASETS[dataset_id] = dataset
        outputs[output_name] = f"http://localhost:8000/dataset/{dataset_id}"

    # Create version object
    version_obj = {
        "version": new_version,
        "parameters": proc.get("params", {}),
        "outputs": outputs,
        "state": "queued",
        "logs": [],
        "dependencies": extract_dependencies(proc.get("params", {}))
    }

    PROCESSES[pid]["versions"].append(version_obj)

    # Broadcast initial queued state
    await update_process_state(pid, new_version, "queued")

    # Start background task to run the process
    asyncio.create_task(run_process_task(pid, new_version))

    # Record transaction for process cost
    if user:
        transaction = {
            "timestamp": datetime.now().isoformat(),
            "type": "debit",
            "description": f"Process run: {PROCESSES[pid]['name']}",
            "amount": -PROCESS_COST,
            "process_id": pid,
            "process_version": new_version,
            "process_name": PROCESSES[pid]["name"]
        }
        user["transactions"].append(transaction)

    # Return process with new version
    return PROCESSES[pid]

@app.get("/processes")
def list_processes(project_id: Optional[str] = None):
    """List all processes, optionally filtered by project_id"""
    if not project_id:
        return list(PROCESSES.values())

    return [p for p in PROCESSES.values() if p.get("project_id") == project_id]

@app.get("/datasets")
def search_datasets(search: str = "", completed_only: bool = True, project_id: Optional[str] = None):
    """Search datasets by process name or dataset name, optionally filtered by project_id"""
    results = []

    for dataset_id, dataset in DATASETS.items():
        # Filter by project_id if provided
        if project_id and dataset.get("project_id") != project_id:
            continue

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
        if xyz_data and "xyz" in xyz_data:
            df = xyz_data["xyz"].flightlines
            if "x" in df.columns and "y" in df.columns:
                x_vals = df["x"].values
                y_vals = df["y"].values

                # Create a point for each row
                for i in range(len(x_vals)):
                    features.append({
                        "type": "Feature",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [float(x_vals[i]), float(y_vals[i])]
                        },
                        "properties": {
                            "index": i,
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

    # Handle XYZ datasets - filter flightlines by title
    if dataset["mime_type"] == "application/x-aarhusxyz-msgpack":
        xyz_data = XYZ_OBJECTS.get(dataset_id)
        if xyz_data and "xyz" in xyz_data:
            df = xyz_data["xyz"].flightlines

            # Verify the part exists and filter by title
            if "title" not in df.columns:
                raise HTTPException(status_code=404, detail="Title column not found")

            # Convert part_path to float if it looks like a number
            try:
                part_path_converted = float(part_path)
            except ValueError:
                part_path_converted = part_path

            part_df = df[df["title"] == part_path_converted]
            if part_df.empty:
                raise HTTPException(status_code=404, detail="Part not found")

            # Return points for this part
            if "x" in part_df.columns and "y" in part_df.columns:
                x_vals = part_df["x"].values
                y_vals = part_df["y"].values

                for i in range(len(x_vals)):
                    features.append({
                        "type": "Feature",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [float(x_vals[i]), float(y_vals[i])]
                        },
                        "properties": {
                            "index": i,
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

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload a file and return a URL to download it"""
    file_id = str(uuid.uuid4())
    content = await file.read()

    UPLOADS[file_id] = {
        "filename": file.filename,
        "content": content,
        "content_type": file.content_type or "application/octet-stream"
    }

    return {
        "url": f"http://localhost:8000/uploads/{file_id}",
        "filename": file.filename
    }

@app.get("/uploads/{file_id}")
def get_uploaded_file(file_id: str):
    """Download an uploaded file"""
    upload = UPLOADS.get(file_id)
    if not upload:
        raise HTTPException(status_code=404, detail="File not found")

    return Response(
        content=upload["content"],
        media_type=upload["content_type"],
        headers={
            "Content-Disposition": f"attachment; filename=\"{upload['filename']}\""
        }
    )

@app.get("/process/{process_id}/logs")
def get_process_logs(process_id: str, version: Optional[int] = None):
    """Get logs for a specific process version (defaults to latest)"""
    process = PROCESSES.get(process_id)
    if not process:
        raise HTTPException(status_code=404, detail="Process not found")

    if version is None:
        # Get latest version
        if not process["versions"]:
            raise HTTPException(status_code=404, detail="No versions found")
        version_obj = process["versions"][-1]
    else:
        # Find specific version
        version_obj = None
        for v in process["versions"]:
            if v["version"] == version:
                version_obj = v
                break

        if not version_obj:
            raise HTTPException(status_code=404, detail="Version not found")

    return {
        "process_id": process_id,
        "version": version_obj["version"],
        "state": version_obj.get("state", "done"),
        "logs": version_obj.get("logs", [])
    }

@app.websocket("/ws/process/{process_id}/logs")
async def websocket_process_logs(websocket: WebSocket, process_id: str, version: Optional[int] = None):
    """WebSocket endpoint for streaming process logs"""
    await websocket.accept()

    process = PROCESSES.get(process_id)
    if not process:
        await websocket.close(code=1008, reason="Process not found")
        return

    if version is None:
        # Use latest version
        if not process["versions"]:
            await websocket.close(code=1008, reason="No versions found")
            return
        version = process["versions"][-1]["version"]

    # Find the version
    version_obj = None
    for v in process["versions"]:
        if v["version"] == version:
            version_obj = v
            break

    if not version_obj:
        await websocket.close(code=1008, reason="Version not found")
        return

    # Register this connection
    if process_id not in LOG_CONNECTIONS:
        LOG_CONNECTIONS[process_id] = []
    LOG_CONNECTIONS[process_id].append(websocket)

    try:
        # Send existing logs
        for log_entry in version_obj.get("logs", []):
            await websocket.send_json(log_entry)

        # Keep connection alive
        while True:
            # Wait for any message from client (keepalive)
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        # Unregister connection
        if process_id in LOG_CONNECTIONS:
            if websocket in LOG_CONNECTIONS[process_id]:
                LOG_CONNECTIONS[process_id].remove(websocket)

@app.websocket("/ws/processes/updates")
async def websocket_process_updates(websocket: WebSocket):
    """WebSocket endpoint for broadcasting process state changes"""
    await websocket.accept()

    # Register this connection
    STATE_CONNECTIONS.append(websocket)
    print(f"🔌 Client connected to process state updates. Total clients: {len(STATE_CONNECTIONS)}")

    try:
        # Keep connection alive
        while True:
            # Wait for any message from client (keepalive)
            await websocket.receive_text()
    except WebSocketDisconnect:
        print(f"🔌 Client disconnected from process state updates")
    except Exception as e:
        print(f"❌ WebSocket error: {e}")
    finally:
        # Unregister connection
        if websocket in STATE_CONNECTIONS:
            STATE_CONNECTIONS.remove(websocket)
        print(f"🔌 Client removed. Total clients: {len(STATE_CONNECTIONS)}")

# Workspace endpoints
@app.get("/workspaces")
def list_workspaces():
    """List all saved workspaces (id and title only)"""
    return [
        {
            "id": ws["id"],
            "title": ws["title"],
            "created_at": ws["created_at"]
        }
        for ws in WORKSPACES.values()
    ]

@app.get("/workspace/{workspace_id}")
def get_workspace(workspace_id: str):
    """Get a specific workspace by ID"""
    workspace = WORKSPACES.get(workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return workspace

@app.post("/workspace")
def save_workspace(workspace: Dict[str, Any]):
    """Save or update a workspace"""
    workspace_id = workspace.get("id")

    # Generate new ID if not provided or if it's "default" (don't allow overwriting default)
    if not workspace_id or workspace_id == "default":
        workspace_id = str(uuid.uuid4())

    new_workspace = {
        "id": workspace_id,
        "title": workspace.get("title", "Untitled Workspace"),
        "layout": workspace.get("layout", {}),
        "created_at": WORKSPACES[workspace_id]["created_at"] if workspace_id in WORKSPACES else datetime.now().isoformat()
    }

    WORKSPACES[workspace_id] = new_workspace
    return new_workspace

@app.delete("/workspace/{workspace_id}")
def delete_workspace(workspace_id: str):
    """Delete a workspace (cannot delete default)"""
    if workspace_id == "default":
        raise HTTPException(status_code=400, detail="Cannot delete default workspace")

    if workspace_id not in WORKSPACES:
        raise HTTPException(status_code=404, detail="Workspace not found")

    del WORKSPACES[workspace_id]
    return {"status": "deleted", "id": workspace_id}
