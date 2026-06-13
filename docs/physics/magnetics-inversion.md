# Magnetics Inversion

Documents the equivalent source gridding and full 3D magnetic inversion processes in `docker/base-runner/mag_processes/` and the underlying inversion systems in the [simplemag](https://github.com/SagebrushGeoTools/simplemag) library.

## Source Files

- `docker/base-runner/mag_processes/equiv_source_process.py` — Equivalent source process wrapper
- `docker/base-runner/mag_processes/inversion_3d_process.py` — 3D inversion process wrapper
- [`equivalent_source.py`](https://github.com/SagebrushGeoTools/simplemag/blob/master/mag_inversion/equivalent_source.py) — MagEquivalentSourceSystem
- [`full_3d.py`](https://github.com/SagebrushGeoTools/simplemag/blob/master/mag_inversion/full_3d.py) — MagInversion3DSystem
- [`sensitivity_cache.py`](https://github.com/SagebrushGeoTools/simplemag/blob/master/mag_inversion/sensitivity_cache.py) — Hash-keyed sensitivity caching

## Equivalent Source Inversion

**Process**: `MagEquivSource` → `MagEquivalentSourceSystem`

### Physical Model

Inverts flight-line TMI (total magnetic intensity) data for an equivalent distribution of magnetic dipoles on a single flat horizontal layer. The layer is placed at `layer__depth_below_flight` metres below the minimum observed flight altitude.

The forward problem uses SimPEG's `Simulation3DIntegral` with full tensor Green's functions for magnetic dipoles in a homogeneous half-space. The integral solution computes the magnetic field at each receiver location as the sum of contributions from all source dipoles.

### Mesh

A `discretize.TensorMesh` with:
- Single vertical cell (`layer__cell_thickness`)
- Horizontal cells of `layer__cell_size` (default 50 m)
- `layer__padding_cells` padding cells around data extent (default 8 per side)

### Model Types

1. **`"scalar"` (susceptibility)**: Assumes induced magnetization aligned with Earth's field. One parameter per cell: `M = χ·H₀`. Models only induced magnetization.

2. **`"vector"` (MVI)**: Three-component magnetization (Mx, My, Mz) per cell. Can represent remanent magnetization with arbitrary direction. `n_params = 3 × n_cells`.

**Reference**: Lelièvre & Oldenburg (2009) for MVI theory.

### Inversion Formulation

- **Data**: TMI values from `magcom` column (nT)
- **Uncertainty**: `σ = 0.02 × |TMI| + 1 nT` (fractional + absolute floor)
- **Data misfit**: L2 norm with `W_d = diag(1/σ)`
- **Regularization**: Tikhonov:
  - `α_s` (smallness): 10⁻⁴ — penalizes deviation from zero susceptibility
  - `α_x`, `α_y` (horizontal smoothness): 1
  - `α_z`: 0 (single cell, no vertical smoothness)
- **Starting model**: χ = 0 (neutral start)
- **Optimizer**: InexactGaussNewton (max 40 iterations, 20 CG per step)
- **Beta schedule**: `BetaEstimate_ByEig` + `BetaSchedule(coolingFactor=2, coolingRate=1)`
- **Optional IRLS**: Iterative reweighted least squares for compact/sparse solutions

### Prediction on Output Grid

After inversion, the recovered dipole layer is used to forward-predict Bx, By, Bz, and TMI on a regular grid at `output__altitude` (default: mean flight altitude). This step uses `Simulation3DIntegral` with `store_sensitivities="forward_only"` (no caching — G is not needed again).

### Output

An **xarray Dataset** with dimensions `(y, x)` containing variables for each requested component (`tmi`, `bx`, `by`, `bz`), plus CRS metadata (`spatial_ref` with WKT). Written as webxtile.

## Full 3D Magnetic Inversion

**Process**: `MagInversion3D` → `MagInversion3DSystem`

### Physical Model

Inverts gridded field components (output of the equivalent source step) for a 3D susceptibility or magnetization vector model using an OcTree (`TreeMesh`) discretization. The same `Simulation3DIntegral` forward operator drives this inversion.

### Model Types

1. **`"scalar"`**: Susceptibility χ (SI) per active cell, induced-only. Works with any single component (usually `tmi`).

2. **`"vector"` (MVI)**: Three-component magnetization per active cell. Requires `bx`, `by`, `bz` input components.

3. **`"amplitude"`**: Scalar susceptibility from the amplitude of the anomalous field:
   ```
   |B_a| = √(Bx² + By² + Bz²)
   ```
   The forward model predicts all three components and internally computes the amplitude. This approach is **remanence-insensitive** (the amplitude depends only on the total magnetization magnitude, not its direction) but does not determine magnetization direction.

**Reference**: Li et al. (2017) for amplitude magnetic inversion.

### Mesh

Adaptive OcTree built with `mesh_builder_xyz` and `refine_tree_xyz`:
- **Core cell size**: `mesh__core_cell_size` (default 50 m)
- **Surface refinement**: Refined around topography using `octree_levels_surf` (default [2, 4])
- **Observation refinement**: Radial refinement around observation points using `octree_levels_obs` (default [2, 4])
- **Depth**: `mesh__depth_core` (default 500 m below observation level)
- **Horizontal padding**: `mesh__max_distance` (default 5000 m beyond data bounds)

Active cells are determined by `active_from_xyz(mesh, topography)` — cells below the topography surface are active.

### Inversion Formulation

- **Data**: Gridded components from equivalent source
- **Uncertainty**: Same fractional + floor model: `σ = 0.02 × |data| + 1 nT`
- **Regularization**: Tikhonov with full 3D smoothness:
  - `α_s = 10⁻⁴`, `α_x = α_y = α_z = 1`
  - `m_ref = 0` (reference model: zero susceptibility)
- **Sensitivity weighting**: Compensates for the natural ~1/r³ decay of magnetic sensitivity with distance from receivers. `UpdateSensitivityWeights` directive scales the regularization so that all depths are penalized approximately equally. This is **strongly recommended** for 3D magnetic inversions to avoid bias toward near-surface structure.

- **Optimizer**: InexactGaussNewton (same schedule as equivalent source)
- **Optional IRLS**: For compact/sparse models

### Output

OcTree cell centres are interpolated (nearest neighbour) onto a regular 3D grid. Output as **xarray Dataset** with dimensions `(z, y, x)`:
- Scalar/amplitude: `susceptibility` (SI units)
- Vector: `mx`, `my`, `mz` (A/m units)

Written as webxtile.

## Sensitivity Matrix Caching

Both inversion systems use `sensitivity_hash()` — a SHA-256 hash computed from:
- Receiver locations (3D coordinates)
- Earth field parameters (intensity, inclination, declination)
- Mesh parameters (cell size, padding, depth)
- Model type (scalar/vector)

The hash determines a subdirectory for on-disk `.npy` sensitivity matrices (`store_sensitivities="disk"`). The process wrappers sync this directory to/from blob storage (`sensitivity_cache/equiv/` and `sensitivity_cache/mag3d/`), enabling reuse across pipeline runs when the survey geometry is unchanged.

## References

- Lelièvre, P. G., & Oldenburg, D. W. (2009). "A 3D total magnetization inversion applicable when significant, complicated remanence is present." *Geophysics*, 74(3), L21-L30. DOI: [10.1190/1.3103249](https://doi.org/10.1190/1.3103249)
- Li, Y., Oldenburg, D. W., Farquharson, C. G., & Shekhtman, R. (2017). "Magnetic amplitude inversion for determining magnetization." *Geophysics*, 82(2). DOI: [10.1190/geo2016-0302.1](https://doi.org/10.1190/geo2016-0302.1)
- Farquharson, C. G., & Oldenburg, D. W. (1998). "Non-linear inversion using general measures of data misfit and model structure." *Geophysical Journal International*, 134(1), 213-227. DOI: [10.1046/j.1365-246x.1998.00555.x](https://doi.org/10.1046/j.1365-246x.1998.00555.x)
- Cockett, R., Kang, S., Heagy, L. J., Pidlisecky, A., & Oldenburg, D. W. (2015). "SimPEG: An open source framework for simulation and gradient based parameter estimation in geophysical applications." *Computers & Geosciences*, 85, 142-154. DOI: [10.1016/j.cageo.2015.09.015](https://doi.org/10.1016/j.cageo.2015.09.015)
