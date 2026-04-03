"""3D gridding process for AEM resistivity models.

Input data structure
--------------------
The input is a libaarhusxyz resistivity model (typically the output of an
inversion process).  It contains a collection of *soundings*, each located
at a surface position (x, y, surface_elev) and described by a 1-D layered
earth model.  Each layer spans a depth interval [dep_top, dep_bot] (metres
below the surface, positive downward) and carries a single uniform scalar
value (e.g. resistivity).  The layer model is therefore a step function in
depth: the value is constant throughout the layer's thickness and changes
discontinuously at every layer boundary.

Algorithm
---------
The goal is to resample these irregularly located, vertically-layered
soundings onto a regular 3-D voxel grid whose vertical axis is absolute
elevation (metres above sea level, positive upward).

**Step 1 – Build a 3-D scatter cloud (step-function vertical assignment)**

For every Z grid level z_k and every sounding i:

  1. Convert the grid elevation to a depth below that sounding's surface::

         depth = surface_elev[i] - z_k

  2. Find which layer contains that depth by counting how many layer
     bottoms lie strictly above it::

         layer_idx = count(dep_bot[i, :] < depth)

  3. If depth falls within the model column (dep_top[i,0] ≤ depth and
     layer_idx < n_layers), emit a scatter point::

         position : (x[i], y[i], z_k)
         value    : col_arr[i, layer_idx]

     Points outside the model column (above the surface or below the
     deepest layer) are omitted.

This produces a cloud of roughly n_soundings × (model_depth / z_spacing)
points.  Each sounding contributes many vertically stacked points sharing
the same (x, y) but differing in z_k.  Within one layer all of those
points carry the identical value, faithfully preserving the step-function
character of the layer model.

**Step 2 – Single 3-D interpolation to the regular grid**

All scatter points from Step 1 are passed at once to a single scipy 3-D
interpolator that fills every node of the n_x × n_y × n_z output grid:

* ``nearest`` – NearestNDInterpolator (KD-tree).  Each grid node receives
  the value of the geometrically closest scatter point in 3-D Euclidean
  space.
* ``linear``  – LinearNDInterpolator (3-D Delaunay triangulation +
  barycentric interpolation).
* ``rbf``     – RBFInterpolator with a linear kernel.

**Why this correctly handles the between-flightline case**

A grid node between two flightlines may sit at an absolute elevation that
some soundings do not reach (e.g. one flightline is in a valley whose
model terminates at a shallower absolute elevation than the grid node).
Those soundings still contribute scatter points at nearby Z levels (just
inside their model range).  The 3-D interpolator sees those points as
3-D-close neighbours and lets them contribute to the grid node — which a
per-Z-level 2-D approach would miss entirely, because such soundings have
no point at exactly z_k.

**Grid bounds**

The horizontal extents [x_min, x_max] and [y_min, y_max] and the vertical
extent [z_min, z_max] are all snapped to exact multiples of the respective
grid spacings measured from the CRS origin (0, 0) and sea level (z = 0),
so every grid coordinate is a round multiple of the chosen spacing.

Performance note
----------------
Scatter-point count ≈ n_soundings × (model_depth / z_spacing).
``nearest`` uses a KD-tree and scales to any survey size.
``linear`` builds a 3-D Delaunay triangulation – acceptable for
small/medium surveys; for large ones prefer ``nearest``.
``rbf`` is the slowest; use only for small datasets.
"""

import json
import os
import uuid
import tempfile
import fsspec
import libaarhusxyz
import libaarhusxyz.export.msgpack
import numpy as np
import xarray as xr
import scipy.interpolate
from .utils import localize_urls


# ─────────────────────────────────────────────────────────────────────────────
# Column-name lookup tables
# ─────────────────────────────────────────────────────────────────────────────

_GEOMETRY_COLUMNS = frozenset(["dep_top", "dep_bot", "height"])

# CF-convention attributes for known output columns.
# Used to annotate xarray variables so the JS client can map them to
# gladly quantity kinds via standard_name / units.
_COLUMN_CF_ATTRS = {
    "resistivity": {
        "standard_name": "electrical_resistivity",
        "units": "ohm m",
        "long_name": "Electrical Resistivity",
    },
    "doi_layer": {
        "standard_name": "depth_of_investigation",
        "units": "m",
        "long_name": "Depth of Investigation",
    },
    "z_bottom": {
        "standard_name": "altitude",
        "units": "m",
        "long_name": "Layer Bottom Elevation",
        "positive": "up",
    },
    "z_top": {
        "standard_name": "altitude",
        "units": "m",
        "long_name": "Layer Top Elevation",
        "positive": "up",
    },
}


def _snap(value, spacing, direction):
    if direction == "floor":
        return np.floor(value / spacing) * spacing
    return np.ceil(value / spacing) * spacing


# ─────────────────────────────────────────────────────────────────────────────
# Topography surface helpers
# ─────────────────────────────────────────────────────────────────────────────

def _interp_topo_from_flightlines(x_snd, y_snd, surface_elev, query_pts):
    """2-D interpolation of topography from sounding surface elevations.

    Uses LinearNDInterpolator within the convex hull of the soundings and
    NearestNDInterpolator for any exterior query points.

    Parameters
    ----------
    x_snd, y_snd : (n_snd,) float64
    surface_elev : (n_snd,) float64
    query_pts    : (M, 2) float64  – (x, y) pairs to evaluate

    Returns
    -------
    topo : (M,) float64
    """
    snd_xy = np.column_stack([x_snd, y_snd])
    lin  = scipy.interpolate.LinearNDInterpolator(snd_xy, surface_elev, fill_value=np.nan)
    topo = lin(query_pts)
    nan_mask = ~np.isfinite(topo)
    if nan_mask.any():
        near = scipy.interpolate.NearestNDInterpolator(snd_xy, surface_elev)
        topo[nan_mask] = near(query_pts[nan_mask])
    return topo


def _build_topo_surface(dtm_path, x_coords, y_coords, x_snd, y_snd, surface_elev):
    """Return (n_x, n_y) float64 array of surface elevation at every grid column.

    If *dtm_path* is given, the GeoTIFF is sampled at each grid (x, y) node.
    Any nodata or NaN holes in the DTM are patched with the flightline
    interpolation.  If *dtm_path* is None the flightline interpolation is used
    for the whole grid.
    """
    n_x, n_y = len(x_coords), len(y_coords)
    gx2d, gy2d = np.meshgrid(x_coords, y_coords, indexing="ij")  # (n_x, n_y)
    xy_flat = np.column_stack([gx2d.ravel(), gy2d.ravel()])       # (n_x*n_y, 2)

    if dtm_path is not None:
        import rasterio  # optional dependency – only needed when a DTM is supplied
        with rasterio.open(dtm_path) as src:
            nodata = src.nodata
            samples = np.array(
                [v[0] for v in src.sample(xy_flat, masked=False)],
                dtype=np.float64,
            )
        if nodata is not None:
            samples[samples == nodata] = np.nan
        topo = samples.reshape(n_x, n_y)
        # Patch any holes (outside DTM extent, nodata cells) from flightline topo
        nan_mask = ~np.isfinite(topo)
        if nan_mask.any():
            fallback = _interp_topo_from_flightlines(
                x_snd, y_snd, surface_elev, xy_flat[nan_mask.ravel()]
            )
            topo[nan_mask] = fallback
    else:
        topo = _interp_topo_from_flightlines(
            x_snd, y_snd, surface_elev, xy_flat
        ).reshape(n_x, n_y)

    return topo


# ─────────────────────────────────────────────────────────────────────────────
# Layer geometry extraction
# ─────────────────────────────────────────────────────────────────────────────

def _get_layer_geometry(xyz):
    """Return (surface_elev, dep_top_arr, dep_bot_arr) from an xyz object.

    All depth arrays are in metres below surface (positive downward).
    surface_elev is in metres above sea level.
    """
    fl = xyz.flightlines
    ld = xyz.layer_data

    surface_elev = np.asarray(fl["Topography"], dtype=np.float64)
    dep_top_arr = np.asarray(ld["dep_top"], dtype=np.float64)
    dep_bot_arr = np.asarray(ld["dep_bot"], dtype=np.float64)

    return surface_elev, dep_top_arr, dep_bot_arr


# ─────────────────────────────────────────────────────────────────────────────
# Scatter-point construction
# ─────────────────────────────────────────────────────────────────────────────

def _build_scatter(
    col_arr,        # (n_snd, n_layers) float64
    dep_top_arr,    # (n_snd, n_layers) float64 – depth to layer top [m below surface]
    dep_bot_arr,    # (n_snd, n_layers) float64 – depth to layer bottom
    surface_elev,   # (n_snd,)          float64 – absolute elevation [m]
    z_coords,       # (n_z,)            float64 – Z grid levels (absolute elevation)
    x_snd,          # (n_snd,)          float64
    y_snd,          # (n_snd,)          float64
):
    """Build 3-D scatter arrays using step-function vertical assignment.

    For each Z grid level ``z_k`` and each sounding ``i``:
      - depth below surface: ``d = surface_elev[i] - z_k``
      - layer index: number of layers whose ``dep_bot < d``
        (i.e., the first layer whose bottom is not yet above ``d``)
      - if ``d`` is within the model range → scatter point at
        ``(x[i], y[i], z_k)`` with ``col_arr[i, layer_index]``

    Returns ``(pts_3d, vals)`` or ``(None, None)`` if no valid points exist.
    pts_3d : (N, 3) float64
    vals   : (N,)   float64
    """
    n_snd, n_layers = col_arr.shape
    model_top = dep_top_arr[:, 0]  # shallowest depth in the model (usually 0 m)

    pts_parts  = []
    vals_parts = []

    for z_k in z_coords:
        depth_k = surface_elev - z_k           # (n_snd,) depth below surface at this Z

        # Vectorised layer lookup:
        # count layers whose bottom lies strictly above our depth point
        layer_idx = (dep_bot_arr < depth_k[:, None]).sum(axis=1)  # (n_snd,)

        # Valid soundings: depth within the model column
        valid = (depth_k >= model_top) & (layer_idx < n_layers)
        if not valid.any():
            continue

        vi = np.where(valid)[0]
        layer_idx_v = layer_idx[vi]
        vals_k = col_arr[vi, layer_idx_v].astype(np.float64)

        # Drop NaN data values
        finite = np.isfinite(vals_k)
        if not finite.any():
            continue
        vi      = vi[finite]
        vals_k  = vals_k[finite]

        pts_parts.append(np.column_stack([
            x_snd[vi],
            y_snd[vi],
            np.full(len(vi), z_k, dtype=np.float64),
        ]))
        vals_parts.append(vals_k)

    if not pts_parts:
        return None, None

    return np.concatenate(pts_parts, axis=0), np.concatenate(vals_parts)


# ─────────────────────────────────────────────────────────────────────────────
# Upload helper
# ─────────────────────────────────────────────────────────────────────────────

def _upload_directory(local_dir, remote_base_url, storage_kwargs):
    for root_dir, _dirs, files in os.walk(local_dir):
        for filename in files:
            local_file = os.path.join(root_dir, filename)
            rel = os.path.relpath(local_file, local_dir).replace(os.sep, "/")
            remote_url = remote_base_url.rstrip("/") + "/" + rel
            with open(local_file, "rb") as src:
                with fsspec.open(remote_url, "wb", **storage_kwargs) as dst:
                    dst.write(src.read())


# ─────────────────────────────────────────────────────────────────────────────
# Process class
# ─────────────────────────────────────────────────────────────────────────────

class Gridding:
    """3-D gridding of AEM resistivity models onto a regular voxel grid.

    Reads scattered sounding data (1-D vertical columns) and produces a
    regular 3-D grid stored in the webxtile format.

    The vertical coordinate is absolute elevation [m above sea level],
    positive upward.  Grid bounds are snapped to exact multiples of the
    grid spacings measured from the CRS / UTM-zone origin and sea level.
    """

    @classmethod
    def schema(cls):
        return {
            "type": "object",
            "properties": {
                "input_model": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "dataset",
                    "title": "Input Resistivity Model",
                    "description": (
                        "Resistivity model dataset to grid "
                        "(output from the inversion process)"
                    ),
                },
                "xy_spacing": {
                    "type": "number",
                    "title": "Horizontal Grid Spacing (m)",
                    "description": "Grid node spacing in X and Y [metres].",
                    "default": 50.0,
                    "exclusiveMinimum": 0,
                },
                "z_spacing": {
                    "type": "number",
                    "title": "Vertical Grid Spacing (m)",
                    "description": "Grid node spacing along the elevation axis [metres].",
                    "default": 10.0,
                    "exclusiveMinimum": 0,
                },
                "interpolation_method": {
                    "type": "string",
                    "enum": ["nearest", "linear", "rbf"],
                    "enumNames": [
                        "Nearest neighbour – fast, recommended for large surveys",
                        "Linear (3-D Delaunay triangulation) – smooth, slower",
                        "Radial basis function – smoothest, slow for large datasets",
                    ],
                    "title": "Interpolation Method",
                    "default": "nearest",
                },
                "dtm": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "dataset",
                    "title": "Digital Terrain Model (optional)",
                    "description": (
                        "GeoTIFF raster of surface elevation in the same CRS as the "
                        "input model.  Used to mask voxels above the terrain surface.  "
                        "If omitted, topography is interpolated from the flightline "
                        "sounding positions."
                    ),
                },
            },
            "required": ["input_model"],
        }

    @classmethod
    def run(cls, storage_context=None, **kwargs):
        """Run 3-D gridding and write the output webxtile dataset."""
        print("Running 3-D gridding…")
        print(f"Parameters: {kwargs}")

        if not storage_context:
            raise ValueError("storage_context is required")

        process_id      = storage_context["process_id"]
        process_version = storage_context["version"]
        storage_base    = storage_context["storage_base"]
        storage_kwargs  = storage_context["storage_kwargs"]

        input_model_url = kwargs.get("input_model")
        if not input_model_url:
            raise ValueError("input_model is required")

        xy_spacing    = float(kwargs.get("xy_spacing",   50.0))
        z_spacing     = float(kwargs.get("z_spacing",    10.0))
        interp_method = kwargs.get("interpolation_method", "nearest")
        dtm_url       = kwargs.get("dtm") or None

        outputs = {}

        urls = {"input": input_model_url}
        if dtm_url:
            urls["dtm"] = dtm_url

        print(f"Loading input model from: {input_model_url}")
        if dtm_url:
            print(f"DTM: {dtm_url}")
        with localize_urls(urls, storage_kwargs) as localized:
            input_path = localized["input"]
            dtm_path   = localized.get("dtm")

            xyz, _gex = libaarhusxyz.export.msgpack.load(input_path, True)
            xyz.normalize(naming_standard="alc")

            if not hasattr(xyz, "layer_data") or not xyz.layer_data:
                raise ValueError(
                    "Input dataset does not appear to be a resistivity model. "
                    "Gridding requires a dataset with layer_data. "
                    "Expected input: output from the inversion process."
                )

            epsg = xyz.model_info.get("projection")
            if not epsg:
                raise ValueError(
                    "Input model has no CRS projection information "
                    "(model_info['projection'] is missing)."
                )
            epsg = int(epsg)

            print(f"CRS: EPSG:{epsg}")
            print(f"Grid spacing: {xy_spacing} m (XY) × {z_spacing} m (Z)")
            print(f"Interpolation: {interp_method}")

            # ── Geometry ──────────────────────────────────────────────────────
            print("Extracting layer geometry…")

            last = xyz.layer_data["dep_bot"].columns[-1]
            second_last = xyz.layer_data["dep_top"].columns[-2]
            dep_top = xyz.layer_data["dep_top"]
            dep_bot = xyz.layer_data["dep_bot"].copy()
            dep_bot[last] = dep_top[last] + dep_top[last] - dep_top[second_last]
            dep_bot = dep_bot.replace([np.inf, -np.inf], np.nan).ffill().bfill()
            dep_top = dep_top.replace([np.inf, -np.inf], np.nan).ffill().bfill()

            surface_elev = xyz.flightlines["Topography"].values
            
            fl = xyz.flightlines
            x_snd = np.asarray(fl["UTMX"], dtype=np.float64)
            y_snd = np.asarray(fl["UTMY"], dtype=np.float64)

            n_snd, n_layers = dep_bot.values.shape
            print(f"Data: {n_snd} soundings × {n_layers} layers")

            # ── Snapped grid bounds ───────────────────────────────────────────
            z_data_max = float(surface_elev.max())
            z_data_min = float((surface_elev[:, None] - dep_bot.values[:,-1]).min())

            x_min = _snap(x_snd.min(), xy_spacing, "floor")
            x_max = _snap(x_snd.max(), xy_spacing, "ceil")
            y_min = _snap(y_snd.min(), xy_spacing, "floor")
            y_max = _snap(y_snd.max(), xy_spacing, "ceil")
            z_min = _snap(z_data_min,   z_spacing, "floor")
            z_max = _snap(z_data_max,   z_spacing, "ceil")

            x_coords = np.arange(x_min, x_max + xy_spacing * 0.5, xy_spacing)
            y_coords = np.arange(y_min, y_max + xy_spacing * 0.5, xy_spacing)
            z_coords = np.arange(z_min, z_max +  z_spacing * 0.5,  z_spacing)

            n_x, n_y, n_z = len(x_coords), len(y_coords), len(z_coords)
            print(
                f"Grid: {n_x}×{n_y}×{n_z} = {n_x*n_y*n_z:,} nodes\n"
                f"  X [{x_min:.1f} … {x_max:.1f}]\n"
                f"  Y [{y_min:.1f} … {y_max:.1f}]\n"
                f"  Z [{z_min:.1f} … {z_max:.1f}]"
            )

            # Flat (M, 3) array of every grid node's 3-D position
            gx, gy, gz = np.meshgrid(x_coords, y_coords, z_coords, indexing="ij")
            grid_pts = np.column_stack([gx.ravel(), gy.ravel(), gz.ravel()])

            # ── Above-topo mask ───────────────────────────────────────────────
            print(
                "Building topography surface"
                + (" from DTM…" if dtm_path else " from flightline soundings…")
            )
            topo_surface = _build_topo_surface(
                dtm_path, x_coords, y_coords, x_snd, y_snd, surface_elev
            )
            # True for every voxel whose centre lies above the terrain surface.
            # Shape (n_x, n_y, n_z) – broadcast topo (n_x, n_y) against z-axis.
            above_topo = gz > topo_surface[:, :, None]

            # ── Columns to grid ───────────────────────────────────────────────
            cols_to_grid = [c for c in xyz.layer_data if c not in _GEOMETRY_COLUMNS]
            if not cols_to_grid:
                raise ValueError(
                    "No physical data columns found to grid. "
                    f"All layer_data keys appear to be geometry columns: "
                    f"{list(xyz.layer_data.keys())}"
                )
            print(f"Columns to grid: {cols_to_grid}")

            # ── Grid each column ──────────────────────────────────────────────
            data_vars = {}

            for col_name in cols_to_grid:
                col_arr = np.asarray(xyz.layer_data[col_name], dtype=np.float64)
                if col_arr.shape != (n_snd, n_layers):
                    print(
                        f"  Skipping '{col_name}': unexpected shape "
                        f"{col_arr.shape} (expected ({n_snd}, {n_layers}))"
                    )
                    continue
                if not np.any(np.isfinite(col_arr)):
                    print(f"  Skipping '{col_name}': all values are NaN/inf")
                    continue

                print(f"  Building scatter for '{col_name}'…")
                pts, vals = _build_scatter(
                    col_arr, dep_top.values, dep_bot.values, surface_elev,
                    z_coords, x_snd, y_snd,
                )
                if pts is None:
                    print(f"  Skipping '{col_name}': no valid scatter points")
                    continue

                print(
                    f"  Interpolating '{col_name}': "
                    f"{len(pts):,} scatter pts → {len(grid_pts):,} grid nodes…"
                )

                try:
                    if interp_method == "nearest":
                        interp = scipy.interpolate.NearestNDInterpolator(pts, vals)
                        gridded = interp(grid_pts)
                    elif interp_method == "linear":
                        interp = scipy.interpolate.LinearNDInterpolator(
                            pts, vals, fill_value=np.nan
                        )
                        gridded = interp(grid_pts)
                    elif interp_method == "rbf":
                        interp = scipy.interpolate.RBFInterpolator(
                            pts, vals, kernel="linear"
                        )
                        gridded = interp(grid_pts)
                    else:
                        raise ValueError(
                            f"Unknown interpolation method: {interp_method!r}"
                        )
                except Exception as exc:
                    print(f"  ERROR gridding '{col_name}': {exc}")
                    continue

                gridded_3d = gridded.reshape(n_x, n_y, n_z).astype(np.float32)
                gridded_3d[above_topo] = np.nan

                data_vars[col_name] = xr.Variable(
                    ["x", "y", "z"],
                    gridded_3d,
                    attrs=_COLUMN_CF_ATTRS.get(col_name, {"long_name": col_name}),
                )

            if not data_vars:
                raise RuntimeError("No columns were successfully gridded.")

            # ── xarray Dataset ────────────────────────────────────────────────
            print("Building xarray Dataset…")
            ds = xr.Dataset(
                data_vars,
                coords={
                    "x": xr.Variable(
                        ["x"], x_coords.astype(np.float64),
                        attrs={
                            "axis": "X",
                            "standard_name": "projection_x_coordinate",
                            "units": "m",
                        },
                    ),
                    "y": xr.Variable(
                        ["y"], y_coords.astype(np.float64),
                        attrs={
                            "axis": "Y",
                            "standard_name": "projection_y_coordinate",
                            "units": "m",
                        },
                    ),
                    "z": xr.Variable(
                        ["z"], z_coords.astype(np.float64),
                        attrs={
                            "axis": "Z",
                            "standard_name": "altitude",
                            "units": "m",
                            "positive": "up",
                        },
                    ),
                },
                attrs={"epsg_code": str(epsg)},
            )

            # ── Write webxtile + upload ────────────────────────────────────────
            dataset_id      = str(uuid.uuid4())
            dataset_prefix  = (
                f"{storage_base}/processes/{process_id}/{process_version}/datasets/{dataset_id}"
            )
            webxtile_remote = f"{dataset_prefix}/webxtile"

            print(f"Writing webxtile to: {webxtile_remote}")
            with tempfile.TemporaryDirectory() as tmpdir:
                local_wt = os.path.join(tmpdir, "webxtile")

                from webxtile import write_webxtile  # deps/webxtile/py
                write_webxtile(
                    ds,
                    local_wt,
                    spatial_dims=["x", "y", "z"],
                    crs=f"EPSG:{epsg}",
                    z_crs="EPSG:5773",  # EGM96 geoid height
                )

                print("Uploading tiles…")
                _upload_directory(local_wt, webxtile_remote, storage_kwargs)

            # ── info.json ─────────────────────────────────────────────────────
            dataset_info = {
                "id": dataset_id,
                "mime_type": "application/x-webxtile",
                "dataset_name": "grid",
                "files": {"application/x-webxtile": webxtile_remote},
                "parts": {},
            }
            info_url = f"{dataset_prefix}/info.json"
            print(f"Writing dataset info: {info_url}")
            with fsspec.open(info_url, "w", **storage_kwargs) as f:
                json.dump(dataset_info, f, indent=2)

            outputs["grid"] = webxtile_remote

        print("3-D gridding complete.")
        return {"status": "success", "outputs": outputs}
