# AEM 3D Gridding

Documents the 3D gridding process in `docker/base-runner/aem_processes/gridding_process.py`.

## Overview

Takes scattered 1D layered resistivity models (output of inversion) and interpolates them onto a regular 3D voxel grid. The vertical coordinate is absolute elevation (m above sea level, positive upward). Grid bounds are snapped to exact multiples of grid spacing from the CRS origin and sea level.

## Algorithm

### Step 1: 3D Scatter Cloud Construction

For each Z grid level `z_k` and each sounding `i`:

```
depth_i = surface_elev[i] - z_k                    # m below surface
layer_idx = count(dep_bot[i, :] < depth_i)         # nth layer whose bottom is above this depth
if dep_top[i, 0] ≤ depth_i and layer_idx < n_layers:
    emit point at (x[i], y[i], z_k) with value = layer_data[i, layer_idx]
```

This preserves the **step-function character** of the layered model — each layer's value is constant throughout its thickness, with a discontinuous change at layer boundaries. Each sounding contributes many vertically stacked points (one per Z level) sharing the same (x, y).

The key advantage of 3D over per-Z-level 2D interpolation: a grid node between two flightlines can sit at an elevation that some soundings don't reach (their model terminates shallower). Those soundings still contribute at nearby Z levels, and the 3D interpolator sees them as 3D-close neighbours.

### Step 2: 3D Interpolation

All scatter points are passed to a single 3D interpolator.

#### scipy methods

| Method | Algorithm | Notes |
|---|---|---|
| `nearest` | `NearestNDInterpolator` (KD-tree) | Fast, scales to any survey size |
| `linear` | `LinearNDInterpolator` (3D Delaunay + barycentric) | Smooth, acceptable for small-medium surveys |
| `rbf` | `RBFInterpolator` (linear kernel) | Global, very slow, small datasets only |

#### pyinterp methods

The `pyinterp` methods convert coordinates from the survey CRS (e.g., UTM) to WGS-84 geographic coordinates (lon/lat/alt) before interpolation. Results are then mapped back to the original CRS grid.

**IDW**: Inverse Distance Weighting (parallel)

**RBF kernels**: multiquadric, Gaussian, inverse multiquadric, cubic, linear, thin plate spline

**Window functions**: Blackman, Blackman-Harris, Boxcar, Flat Top, Gaussian, Hamming, Lanczos, Nuttall, Parzen, Parzen SWOT

**Universal Kriging**: Exponential, Gaussian, Linear, Matérn 1/2/3/2/5/2, Spherical, Whittle-Matérn

### Topography Masking

After interpolation, voxels above the terrain surface are set to NaN. The terrain surface is constructed from:
1. A DTM GeoTIFF (if provided) — sampled at each grid node using `rasterio.sample()`, with nodata holes patched from flightline interpolation
2. Flightline surface elevations (if no DTM) — interpolated using `LinearNDInterpolator` within convex hull, `NearestNDInterpolator` outside

## Output Format

The gridded data is written as a **webxtile** — a tiled format for WebGL rendering (used by the gladly frontend). The xarray Dataset:

- Dimensions: `(x, y, z)` with CF-convention attributes (projection_x/y_coordinate, altitude, positive: up)
- Variables: Each physical column from layer_data (typically `resistivity`, plus any other columns like `doi_layer`)
- Attributes: EPSG code, spatial reference
- The `z` dimension uses EGM96 geoid height (EPSG:5773) for vertical CRS

## Grid Bounds

All grid bounds are snapped to exact multiples of the grid spacing from the coordinate system origin (0, 0) and sea level (z = 0):

```
low = floor(data_min / spacing) * spacing
high = ceil(data_max / spacing) * spacing
```

This ensures every grid coordinate is a round multiple of the chosen spacing.

## Source Code

- `docker/base-runner/aem_processes/gridding_process.py` — Full implementation with docstring
