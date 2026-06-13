# AEM Inversion & Forward Modelling

Documents the inversion and forward modelling processes for airborne electromagnetics (TEM), powered by a custom fork of SimPEG.

## Source Files

- `docker/base-runner/aem_processes/inversion_process.py` — Inversion process wrapper
- `docker/base-runner/aem_processes/forward_process.py` — Forward modelling process wrapper
- [`SimPEG/electromagnetics/utils/static_instrument/`](https://github.com/redhog/simpeg/tree/main/SimPEG/electromagnetics/utils/static_instrument) — Custom instrument classes
- `docker/base-runner/aem_processes/directives.py` — Custom SimPEG directives (reporting, iteration output)

## System Description Architecture

The [`SimPEG/electromagnetics/utils/static_instrument/`](https://github.com/redhog/simpeg/tree/main/SimPEG/electromagnetics/utils/static_instrument) directory defines a hierarchy of instrument descriptions for moving EM platforms (AEM, TTEM). The key design principle is that the geometric configuration of transmitter(s) and receiver(s) is **independent of the data** — only their absolute positions change per-sounding.

### XYZSystem (base class)

**Source**: `base.py`

Base class for all AEM system descriptions. Core responsibilities:

1. **System instantiation**: Takes a `libaarhusxyz.XYZ` object and optional keyword parameters (which override class-level defaults via `__getattribute__`)
2. **Filtering**: Applies `sounding_filter` (row-wise) and `gate_filter` (column-wise) via `xyzfilter.FilteredXYZ`
3. **Survey construction**: `make_survey()` iterates over all soundings, calling `make_system()` to create SimPEG sources for each
4. **Inversion assembly**: Chain of `make_thicknesses()` → `make_misfit()` → `make_regularization()` → `make_optimizer()` → `make_inversion()`
5. **Model <-> XYZ conversion**: `inverted_model_to_xyz()` and `forward_data_to_xyz()` convert between SimPEG model vectors and libaarhusxyz format

### SingleMomentTEMXYZSystem

**Source**: `single.py`

A simple single-moment system suitable for synthetic data:

- One `CircularLoop` transmitter with configurable area and current
- Default perfect `StepOffWaveform`; optional custom `PiecewiseLinearWaveform`
- One `PointMagneticFluxTimeDerivative` receiver at the transmitter location
- `dipole_moments = [area × i_max]`

### DualMomentTEMXYZSystem

**Source**: `dual.py`

Dual-moment system describing SkyTEM instruments. Cannot be instantiated directly — use `DualMomentTEMXYZSystem.load_gex(gex)` to generate a subclass from a GEX instrument file.

Key features:
- **Two sources**: Low Moment (Channel 1) and High Moment (Channel 2), each as a `MagDipole` with separate `PiecewiseLinearWaveform` from the GEX file
- **Receiver offset**: Rx position relative to Tx from `gex.General['RxCoilPosition']`
- **Tilt correction**: `correct_tilt_pitch_for1Dinv()` — same (cos·cos)² factor as the pipeline
- **Gate factor scaling**: Data multiplied by `gex.ChannelN['GateFactor']` (Aarhus Workbench convention)
- **Automatic sounding filter**: Excludes soundings where no usable gates remain in either channel
- **Gate filtering**: Configurable gate ranges via `gate_filter__start_lm/end_lm` and `gate_filter__start_hm/end_hm`

## Inversion Formulation

### Forward Model

Uses `SimPEG.electromagnetics.time_domain.Simulation1DLayeredStitched` — a 1D layered earth EM solution computed independently per sounding, stitched into a pseudo-2D model. For each sounding, the solver computes the vertical magnetic field response of a layered half-space to a magnetic dipole source with an arbitrary waveform.

The 1D solution uses the Hankel transform for the frequency-domain solution (via digital filter coefficients) and the Fourier transform (via cosine/sine transforms) to convert to time domain. Layer conductivities are transformed using `maps.ExpMap` (σ = exp(m)).

**Solver options**:
- Pardiso (direct sparse, multi-threaded) — requires `pymatsolver.PardisoSolver`
- Default spLU (SuperLU) — fallback

**Parallelism**: Configurable `n_cpu` threads for sounding-parallel computation.

### Model Discretization

**Layer thicknesses**: Three options via `startmodel__thicknesses_type`:
1. **Log-spaced** (default): 30 layers, 1 m → 400 m depth range. `build_log_spaced_layer_thick()` iteratively adjusts the last layer to match the target depth exactly.
2. **Geometric**: Constant geometric factor (default 1.15309) between successive layers.
3. **Time-based**: Derived from gate times and background conductivity using `get_vertical_discretization_time()`.

The model vector has `n_param = n_layers × n_soundings` parameters (plus one half-space). Resistivity is log-transformed: `σ = exp(m)`, initialized to `1/startmodel__res` (default 100 Ω·m).

### Data Misfit

Weighted L2 norm with weights = `1 / uncertainty`:

```
φ_d = ||W_d · (d_obs - d_pred)||²
```

where the per-datum uncertainty combines:
- STD from stacking (`STD_Ch##` values, capped to minimum `uncertainties__std_data` = 3%)
- Time-dependent noise floor: `noise_level_1ms × (t × 1000)^(noise_exponent) / moment`
- `W_d = diag(1 / (std × |data| + noise))`

### Regularization

**LaterallyConstrainedInversion (LCI)** using two-mesh approach:

- **Horizontal mesh**: `SimplexMesh` built from Delaunay triangulation of sounding (x, y) coordinates
- **Vertical mesh**: 1D tensor mesh from layer thicknesses
- **Regularization mesh**: Cartesian product of horizontal × vertical meshes
- **Objective**: `φ_m = α_s · ||W_s · (m - m_ref)||² + α_r · ||W_r · (G_r · m)||² + α_z · ||W_z · (G_z · m)||²`

  - `α_s` (smallness): Penalizes deviation from reference model (default 10⁻⁴)
  - `α_r` (radial smoothness): Penalizes lateral roughness between adjacent soundings (default 1)
  - `α_z` (vertical smoothness): Penalizes vertical roughness between adjacent layers (default 1)

**Reference model**: `m_ref = 1/100 S/m` (uniform 100 Ω·m half-space).

**Reference**: Auken et al. (2002) for laterally constrained inversion theory.

### Inversion Algorithm

1. **Beta estimation**: `BetaEstimate_ByEig` — computes initial regularization weight from eigenvalue spectrum of `JᵀJ`
2. **Beta schedule**: `BetaSchedule(coolingFactor=2, coolingRate=1)` — halves beta every iteration
3. **Target misfit**: Stopping criterion when `φ_d ≈ N_data`
4. **Optimization**: `InexactGaussNewton` — inexact Newton with conjugate-gradient inner iterations (max 20 CG per step, max 40 GN iterations total)

### Sparse Model (IRLS)

Optional iterative reweighted least squares (IRLS) produces a "focused" model with sharper boundaries:

```
IRLS iteration: update weights W_R^(k+1) = diag(1 / (|m_j - m_ref|^(2-p/2) + ε))
```

where p ≈ 1 gives blocky/sparse solutions. Runs after L2 convergence.

**References**: Last & Kubik (1983), Farquharson & Oldenburg (1998).

## Forward Modelling

**Source**: `forward_process.py`

Takes a resistivity model (libaarhusxyz format with `resistivity`, `dep_top`, `dep_bot`) and computes synthetic dB/dt responses using the same system description and `Simulation1DLayeredStitched`.

The model is passed directly as log-conductivity: `m = ln(1/resistivity)`. The output is a libaarhusxyz dataset with:
- Synthetic `Gate_Ch##` data
- `InUse_Ch##` flags set to 1 where data is finite
- `STD_Ch##` set to GEX `UniformDataSTD`
- `Current_Ch##` filled from GEX approximate current
- Tilt columns defaulted to zero

## Result Conversion

### inverted_model_to_xyz()

Converts the inversion result back to libaarhusxyz format:
```
resistivity = 1 / exp(model.reshape(n_soundings, n_layers))
```

### forward_data_to_xyz()

Converts predicted data to libaarhusxyz format, computing per-sounding residuals and RMS misfit:
```
resdata[i] = sqrt(mean(derr[i, :]²))  where derr = (d_obs - d_pred) × W_d
```

## Custom Directives

**Source**: `directives.py`

- **ReportingDirective**: Logs iteration progress (phi_d, phi_m, beta, CG iterations)
- **SaveOutputEveryIteration**: Saves intermediate model and synthetic data at every GN iteration, enabling convergence monitoring

## References

- Auken, E., Christiansen, A. V., Westergaard, J. H., Kirkegaard, C., Foged, N., & Viezzoli, A. (2009). "An integrated processing scheme for high-resolution airborne electromagnetic surveys, the SkyTEM system." *Exploration Geophysics*, 40(2), 184-192. DOI: [10.1071/eg08128](https://doi.org/10.1071/eg08128)
- Auken, E., Foged, N., & Sørensen, K. I. (2002). "Model recognition by 1-D laterally constrained inversion of resistivity data." *Geophysics*, 67(5), 1468-1475. DOI: [10.1190/1.1512750](https://doi.org/10.1190/1.1512750)
- Cockett, R., Kang, S., Heagy, L. J., Pidlisecky, A., & Oldenburg, D. W. (2015). "SimPEG: An open source framework for simulation and gradient based parameter estimation in geophysical applications." *Computers & Geosciences*, 85, 142-154. DOI: [10.1016/j.cageo.2015.09.015](https://doi.org/10.1016/j.cageo.2015.09.015)
- Farquharson, C. G., & Oldenburg, D. W. (1998). "Non-linear inversion using general measures of data misfit and model structure." *Geophysical Journal International*, 134(1), 213-227. DOI: [10.1046/j.1365-246x.1998.00555.x](https://doi.org/10.1046/j.1365-246x.1998.00555.x)
