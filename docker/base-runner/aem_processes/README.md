# AEM Processes for Nagelfluh

This package provides AEM (Airborne Electromagnetic) data processing
for the Nagelfluh framework based on
https://github.com/emerald-geomodelling/emerald-beryl-pipeline

## Overview

The package provides three main process types for geophysics data processing:

1. **import_skytem** - Import SkyTEM survey data from XYZ/GEX files
2. **process_tem** - Apply data processing steps to imported data
3. **invert_tem** - Run 3D electromagnetic inversions using SimPEG

## Architecture

### Ported from Luigi to Nagelfluh

The original emerald-beryl-pipeline used Luigi for workflow orchestration with:
- Config files (YAML) for parameters
- File-based dependencies
- `DONE` marker files for completion tracking

The Nagelfluh port replaces these with:
- JSON Schema for parameters (dynamically generated from entry points)
- Dataset URL references for dependencies
- Process completion status tracking
- fsspec for cloud-native file storage

### File Structure

Each process writes datasets in the Nagelfluh structure:

```
{storage_base}/processes/{process_id}/datasets/{dataset_id}/
├── root.msgpack          # Main XYZ+GEX data
├── root.geojson         # Geography (GeoJSON)
├── parts/
│   ├── {flight_line}.msgpack   # Per-line data
│   └── {flight_line}.geojson   # Per-line geography
└── info.json            # Dataset metadata
```

### Schema Generation

Schemas are defined directly in process classes:
- `import_skytem` - Static schema in `LibaarhusXYZImporter.schema()`
- `process_tem` - Dynamic schema from `emeraldprocessing.pipeline_step` entry points
- `invert_tem` - Dynamic schema from `simpeg.static_instrument` entry points

## Installation

### Basic Installation

```bash
cd docker/base-runner/aem_processes
pip install -e .
```

This installs core dependencies for file I/O and schema generation.

### Full Installation (with processing and inversion)

```bash
pip install -e ".[all]"
```

This additionally installs:
- `emeraldprocessing` - Processing pipeline framework
- `simpeg` - Inversion framework
- `emerald-monitor` - Resource monitoring

## Usage

### 1. Import Process (`import_skytem`)

Imports SkyTEM survey data from XYZ/GEX files.

**Parameters:**
```json
{
  "xyzfile": "s3://bucket/survey.xyz",
  "gexfile": "s3://bucket/survey.gex",
  "alcfile": "s3://bucket/survey.alc",  // optional
  "scalefactor": 1e-12,
  "projection": 32611  // EPSG code
}
```

**Outputs:**
- `imported_data` - Survey dataset with XYZ+GEX data

**Features:**
- Automatic flight-line splitting
- Coordinate system normalization (ALC naming standard)
- URL localization (downloads remote files during processing)

### 2. Processing Process (`process_tem`)

Applies processing steps to imported data.

**Parameters:**
```json
{
  "input_data": "dataset://previous-process-id/dataset-id",
  "steps": [
    {
      "name": "Workbench import",
      "args": {
        // Step-specific parameters
      }
    }
  ],
  "data_loader": {
    "name": "emeraldprocessing.pipeline.ProcessingData"
  }
}
```

**Outputs:**
- `processed_data` - Processed survey dataset

**Features:**
- Pluggable processing steps via entry points
- Automatic inversion-ready column generation (`num_*` fields)
- Flight-line splitting maintained

### 3. Inversion Process (`invert_tem`)

Runs 3D electromagnetic inversions.

**Parameters:**

The schema is dynamically generated from `simpeg.static_instrument` entry points. All inversion parameters are nested under `system: {"Dual moment TEM": {...}}`. The defaults below come directly from `deps/simpeg/SimPEG/electromagnetics/utils/static_instrument/base.py` and `dual.py` — verify against source before relying on them.

```json
{
  "input_data": "<file URL from get_dataset — see IMPORTANT note below>",
  "system": {
    "Dual moment TEM": {
      "startmodel": {
        "n_layer": 30,              // default; 40 is commonly used for deeper surveys
        "thicknesses_type": "logspaced",
        "thicknesses_minimum_dz": 1,
        "thicknesses_geometric_factor": 1.15309,  // only used when thicknesses_type="geometric"
        "top_depth_last_layer": 400,
        "res": 100
      },
      "regularization": {
        "alpha_s": 1e-4,            // default; see scaling guide in base.py
        "alpha_z": 1.0,             // default; reduce (e.g. 0.25–0.5) for sharper vertical structure
        "alpha_r": 1.0              // default; increase (e.g. 2.5–10) for stronger lateral continuity
      },
      "uncertainties": {
        "std_data_override": false,
        "noise_level_1ms": 1e-9,    // default; lower to ~1e-11 to effectively disable noise floor
        "noise_exponent": -0.5,
        "std_data": 0.03            // minimum fractional uncertainty floor (3%)
      },
      "gate_filter": {
        "start_lm": 5,              // default (1-based index); open wider (e.g. 1) to include early gates
        "end_lm": 28,
        "start_hm": 10,             // default; open wider (e.g. 1) to include early HM gates
        "end_hm": 32
      },
      "directives": {
        "irls": {
          "enable": false,
          "max_iterations": 30
        },
        "beta": {
          "beta0_ratio": 10,        // default; increase to ~50 for slower, more thorough beta cooling
          "cooling_factor": 2,      // MUST be integer — float (e.g. 1.5) fails schema validation
          "cooling_rate": 1
        }
      },
      "optimizer": {
        "max_iter_cg": 20,
        "max_iter": 50
      },
      "simulation": {
        "n_cpu": 26,                // 26 CPUs available on the Z840 workstation
        "solver": "LU",
        "parallel": true
      },
      "tx_orientation": "z",
      "rx_orientation": "z",
      "validate": true
    }
  },
  "save_iterations": false
}
```

> **IMPORTANT — `input_data` URL format**: Pass the `/api/files/...` URL from `get_dataset`, NOT the `/api/dataset/{id}` shortform URL from process outputs. The shortform URL causes a `ClientSession` error at runtime.
>
> **IMPORTANT — `system` key structure**: All inversion parameters go inside `system: {"Dual moment TEM": {...}}`. Do NOT pass `startmodel`, `regularization`, etc. at the top level — that causes `ValueError: system configuration is required`.
>
> **IMPORTANT — `cooling_factor` must be an integer**: `cooling_factor: 1.5` (float) fails schema validation. Use `2`, `3`, etc.

**To get the live schema with all current defaults**, query the API:
```bash
GET /environments/{env_id}/process-types/invert_tem
```
or via MCP: `get_process_type_schema_environments__env_id__process_types__type_name__get`
```

**Outputs:**
- `processed` - Corrected data
- `smooth_model` - L2 regularization model
- `smooth_synthetic` - L2 forward response
- `sparse_model` - Sparse regularization model (if available)
- `sparse_synthetic` - Sparse forward response (if available)
- `intermediate_{N}_model` - Iteration snapshots (if save_iterations=true)
- `intermediate_{N}_synthetic` - Iteration forward models

**Features:**
- SimPEG-based inversions
- Custom directives for logging (iteration metrics, RMSE)
- Resource monitoring (CPU, memory usage)
- Optional intermediate model saving
- Flight-line splitting maintained

## Entry Points

### Process Types

Registered in `nagelfluh.process_types`:
- `import_skytem` → `aem_processes.import_process:LibaarhusXYZImporter`
- `process_tem` → `aem_processes.processing_process:Processing`
- `invert_tem` → `aem_processes.inversion_process:Inversion`

### Processing Steps

Uses `emeraldprocessing.pipeline_step` entry points from emeraldprocessing package.

### Inversion Systems

Uses `simpeg.static_instrument` entry points from SimPEG package.

## Data Format

All datasets use `libaarhusxyz` format:
- **XYZ** - Geophysics survey data (soundings, flightlines, layer data)
- **GEX** - System description and calibration
- **msgpack** - Binary serialization (includes both XYZ and GEX)

Reading datasets:
```python
import libaarhusxyz

# Load from msgpack (includes GEX)
xyz, gex = libaarhusxyz.export.msgpack.load("path/to/root.msgpack", True)
```

Writing datasets:
```python
# Write msgpack with GEX
xyz.to_msgpack("path/to/output.msgpack", gex=gex_object)
```

## Differences from Original Pipeline

### Removed Features
- Luigi task orchestration → Nagelfluh handles dependencies
- Config files (YAML) → JSON Schema parameters
- Integration task → Nagelfluh orchestrates workflows
- Introspect task → Schemas generated on-demand

### Enhanced Features
- Cloud-native storage (fsspec instead of poltergust-luigi-utils)
- Dynamic schema generation from entry points
- Unified dataset structure across all processes
- Direct dataset URL references (no need for import_name paths)

### Preserved Features
- Entry point plugin system (importers, steps, systems)
- Flight-line splitting
- Resource monitoring (inversions)
- Iteration logging
- Multi-format outputs (msgpack, GeoJSON)

## Development

### Modifying the Importer

The `LibaarhusXYZImporter` class is a Nagelfluh process that imports SkyTEM data. To modify it:

1. Update the `schema()` classmethod to change parameters
2. Update the `run()` classmethod to change import logic
3. The class uses `libaarhusxyz.Survey` for data handling

### Adding New Processing Steps

Use the `emeraldprocessing` package - steps are automatically discovered via entry points.

### Adding New Inversion Systems

Use the `simpeg` package - systems are automatically discovered via `simpeg.static_instrument` entry points.

## Dependencies

### Core Dependencies
- `libaarhusxyz` - Geophysics data format
- `swaggerspect` - Schema generation for processing and inversion steps
- `fsspec` - Cloud storage abstraction
- `python-slugify` - Flight-line name sanitization

### Optional Dependencies (with `[all]`)
- `emeraldprocessing` - Processing pipeline
- `simpeg` - Inversion framework
- `emerald-monitor` - Resource monitoring

## License

Same as emerald-beryl-pipeline (see original package).
