# Dataset statistics output

**GitHub Issue:** #14
**State:** open
**Labels:** backend, pipeline, aem, mag, cleanup

## Description

_Migrated from deprecated-nagelfluh #18 (originally by @redhog)_

Pre-compute a `stats.json` file for every dataset at process-run time and store it
alongside the data. Remove the current on-demand `describe_dataset` backend endpoint.
Update the `get_dataset` MCP docstring so the LLM knows to look for the stats file.

## Stats file

**Mime type:** `application/vnd.nagelfluh.stats+json`

Stored in the `files` dict of the root and each part, at the same level as the
primary data file.

### Per-column statistics (all numeric columns, skip non-numeric silently)

`count`, `min`, `max`, `mean`, `geometric_mean` (log-space, positive values only),
`std`, `p5`, `p25`, `p50`, `p75`, `p95`, `skewness`, `kurtosis`

Stats are computed over non-NaN values only. Column iteration is fully generic —
no hardcoded column names anywhere in the stats code.

### XYZ / AEM structure (mirrors the msgpack layout)

```json
{
  "flightline_count": 42,
  "total_soundings": 12500,
  "crs": 32632,
  "flightlines": {
    "<col>": { "count": ..., "min": ..., "max": ..., "mean": ...,
               "geometric_mean": ..., "std": ...,
               "p5": ..., "p25": ..., "p50": ..., "p75": ..., "p95": ...,
               "skewness": ..., "kurtosis": ... }
  },
  "layer_data": {
    "<channel>": {
      "all": { ... },   // stats across all layers concatenated
      "0":   { ... },   // stats for layer index 0
      "1":   { ... }
    }
  }
}
```

Iterates `xyz.flightlines.columns` and `xyz.layer_data.keys()` — whatever is present.
For each `layer_data` channel, iterates the DataFrame columns (layer indices 0, 1, …).

### MAG structure

```json
{
  "line_count": 15,
  "total_soundings": 50000,
  "crs": "EPSG:32633",
  "columns": {
    "<col>": { "count": ..., ... }
  }
}
```

Iterates `mag_data.data.columns` — whatever is present.

### Grid / webxtile structure

```json
{
  "crs": "EPSG:32633",
  "z_crs": "EPSG:5773",
  "dims": { "x": 500, "y": 300, "z": 50 },
  "coords": { "x": [...], "y": [...], "z": [...] },
  "variables": {
    "<var>": {
      "all": { ... },   // stats over entire 3-D array
      "0":   { ... },   // stats for z-slice 0 (last dim)
      "1":   { ... }
    }
  }
}
```

Iterates `ds.data_vars` — whatever is present. For variables with 3+ dimensions,
iterates the last dimension as the "layer" axis (per-slice stats). For 1-D or 2-D
variables, only `"all"` is produced. Coord arrays are included verbatim when
≤ 1000 values.

## Scope: both per-parts and root

Stats are written for the root dataset (all data) **and** for every part (per
flight-line or per-line). Each `files` dict gains the
`"application/vnd.nagelfluh.stats+json"` entry pointing to its own `stats.json`.

## Files to create

| File | Contents |
|------|----------|
| `docker/base-runner/aem_processes/aem_processes/stats.py` | `STATS_MIME`, `compute_column_stats(arr)`, `compute_xyz_stats(xyz)`, `compute_grid_stats(ds)` |
| `docker/base-runner/mag_processes/mag_processes/stats.py` | `STATS_MIME`, `compute_column_stats(arr)`, `compute_mag_stats(mag_data)`, `compute_grid_stats(ds)` |

`compute_column_stats` is duplicated across the two packages (no shared dep). `compute_grid_stats` appears in both because AEM gridding and MAG both write webxtile.

## Files to modify

| File | Change |
|------|--------|
| `docker/base-runner/aem_processes/aem_processes/dataset_utils.py` | Import `compute_xyz_stats`, `STATS_MIME`; after writing each msgpack (root and each part), compute stats and write `stats.json`; add entry to `files` dict |
| `docker/base-runner/aem_processes/aem_processes/gridding_process.py` | Import `compute_grid_stats`, `STATS_MIME`; after `_upload_directory`, compute stats from `ds` and write `stats.json`; add entry to `dataset_info["files"]` |
| `docker/base-runner/mag_processes/mag_processes/dataset_utils.py` | Import `compute_mag_stats`, `compute_grid_stats`, `STATS_MIME`; same pattern for both `write_dataset` and `write_webxtile_dataset` |
| `backend/routers/datasets.py` | Delete `_describe_xyz`, `_describe_json_bytes`, `_describe_geojson`, `_describe_msgpack_generic`, `_compute_description`, and the `describe_dataset` endpoint (lines 18–125, 223–268); update `get_dataset` docstring |

## Updated `get_dataset` docstring (MCP-facing)

The docstring must tell the LLM:

> The `files` dict in the response (nested under `"files"` at the root and under
> `"parts".<name>."files"` for each part) may contain a key
> `"application/vnd.nagelfluh.stats+json"`. Fetching that URL returns a JSON
> document with pre-computed column-level statistics:
> `count`, `min`, `max`, `mean`, `geometric_mean`, `std`,
> percentiles `p5`/`p25`/`p50`/`p75`/`p95`, `skewness`, `kurtosis`.
> For XYZ/AEM datasets the document has `flightlines` and `layer_data` sections
> (the latter with per-layer and `"all"` keys). For MAG datasets it has a `columns`
> section. For grid/webxtile datasets it has a `variables` section with per-z-slice
> and `"all"` keys. Use the stats URL to inspect a dataset without downloading the
> full binary file.

## Tasks

- [ ] Create `aem_processes/stats.py` (`compute_column_stats`, `compute_xyz_stats`, `compute_grid_stats`)
- [ ] Create `mag_processes/stats.py` (`compute_column_stats`, `compute_mag_stats`, `compute_grid_stats`)
- [ ] Update `aem_processes/dataset_utils.py` — root + per-part stats for XYZ
- [ ] Update `aem_processes/gridding_process.py` — stats for grid output
- [ ] Update `mag_processes/dataset_utils.py` — stats for MAG (`write_dataset`) and grid (`write_webxtile_dataset`)
- [ ] Update `backend/routers/datasets.py` — remove on-demand describe code; update `get_dataset` docstring
