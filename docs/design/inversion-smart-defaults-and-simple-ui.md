# Inversion UX: Smart Defaults and Simple UI Mode

**Status:** Draft — not yet implemented  
**Context:** After working through a synthetic forward-model test inversion, it became clear that setting regularization and convergence parameters requires expert EM geophysics knowledge. This design makes `invert_tem` usable by non-experts while keeping full control available to experts.

---

## Problems Being Solved

1. `alpha_s` requires knowing survey sounding/line spacing and understanding the 1/h² scaling rule — but both pieces of information are already in the data.
2. `alpha_r` is a dimensionless weight that has no intuitive physical meaning; what a user actually wants to specify is a *lateral resolution in meters*.
3. `alpha_z` has the same problem in the vertical direction.
4. The convergence parameters (`cooling_factor`, `beta0_ratio`, `max_iter`) are opaque; most users just need a "how hard should it try" dial.
5. The full parameter list is overwhelming for a new user but necessary for expert tuning.

---

## Change 1 — Auto-derive `alpha_s` from data geometry (backend)

### What changes
`regularization__alpha_s` becomes optional (default `None`). When `None`, `make_regularization` computes it from the sounding positions before building the regularization object.

### Implementation sketch (`base.py`)

```python
regularization__alpha_s = None
"""Smallness weight. When None (default), auto-computed from sounding and line spacing
using alpha_s = 1 / geomean(sounding_spacing, line_spacing)². Set explicitly only if
you need to override the auto value — see the full docstring on the class for guidance."""

def _compute_sounding_spacing(self):
    coords = self.xyz.flightlines[
        [self.xyz.x_column, self.xyz.y_column]
    ].astype(float).values
    tree = cKDTree(coords)
    dists, _ = tree.query(coords, k=2)
    return float(np.median(dists[:, 1]))

def _compute_line_spacing(self):
    line_col = 'Line'
    if line_col not in self.xyz.flightlines.columns:
        return self._compute_sounding_spacing()  # fall back to sounding spacing
    centroids = (
        self.xyz.flightlines
        .groupby(line_col)[[self.xyz.x_column, self.xyz.y_column]]
        .mean()
        .values
        .astype(float)
    )
    if len(centroids) < 2:
        return self._compute_sounding_spacing()
    tree = cKDTree(centroids)
    dists, _ = tree.query(centroids, k=2)
    return float(np.median(dists[:, 1]))

def _resolve_alpha_s(self):
    if self.regularization__alpha_s is not None:
        return self.regularization__alpha_s
    ss = self._compute_sounding_spacing()
    ls = self._compute_line_spacing()
    h = np.sqrt(ss * ls)
    alpha_s = 1.0 / h**2
    print(f"Auto alpha_s: sounding_spacing={ss:.1f}m  line_spacing={ls:.1f}m  h={h:.1f}m  alpha_s={alpha_s:.2e}")
    return alpha_s
```

Then in `make_regularization`, replace `self.regularization__alpha_s` with `self._resolve_alpha_s()`.

### Notes
- Single-line datasets (all soundings on one line) fall back to sounding spacing for both dimensions, giving `h = sounding_spacing` and `alpha_s = 1/spacing²`.
- The print statement lets experts audit the auto value in the job logs without having to look it up themselves.

---

## Change 2 — `target_lateral_resolution_m` replaces `alpha_r` in simple mode (backend)

### What changes
Add a new user-facing parameter. When set, it computes `alpha_r` internally. `alpha_r` becomes an advanced override.

```python
regularization__target_lateral_resolution_m = None
"""Target effective lateral resolution in meters. When set, alpha_r is computed as
(target / sounding_spacing)² × alpha_z, which weights the lateral gradient penalty
so that features smaller than `target` are smoothed out. Default None leaves alpha_r
at its explicit value (default 1.0). Typical starting point: 3 × sounding spacing."""

regularization__alpha_r = 1.
"""Lateral smoothness weight (advanced). Overridden by target_lateral_resolution_m
when that is set. See the class docstring for the full explanation."""
```

Resolution of `alpha_r` at runtime:

```python
def _resolve_alpha_r(self):
    target = self.regularization__target_lateral_resolution_m
    if target is None:
        return self.regularization__alpha_r
    ss = self._compute_sounding_spacing()
    alpha_r = (target / ss) ** 2 * self._resolve_alpha_z()
    print(f"Auto alpha_r: target_lateral={target}m  sounding_spacing={ss:.1f}m  alpha_r={alpha_r:.2f}")
    return alpha_r
```

---

## Change 3 — `target_vertical_resolution_m` replaces `alpha_z` in simple mode (backend)

### What changes
Same pattern as Change 2 but for vertical smoothing. The reference scale is the median layer thickness of the generated model, which is computed from `make_thicknesses()`.

```python
regularization__target_vertical_resolution_m = None
"""Target effective vertical resolution in meters. When set, alpha_z is computed as
(target / median_layer_thickness)², where median_layer_thickness is derived from the
log-spaced layer scheme. Features thinner than `target` are smoothed. Default None
leaves alpha_z at its explicit value (default 1.0). Typical starting point: 10–20 m
for a 30-layer model to 400 m depth."""

regularization__alpha_z = 1.
"""Vertical smoothness weight (advanced). Overridden by target_vertical_resolution_m
when that is set."""
```

Resolution:

```python
def _resolve_alpha_z(self):
    target = self.regularization__target_vertical_resolution_m
    if target is None:
        return self.regularization__alpha_z
    thk = self.make_thicknesses()
    median_thk = float(np.median(thk))
    alpha_z = (target / median_thk) ** 2
    print(f"Auto alpha_z: target_vertical={target}m  median_layer_thickness={median_thk:.1f}m  alpha_z={alpha_z:.2f}")
    return alpha_z
```

**Note:** `_resolve_alpha_r` calls `_resolve_alpha_z` so that the lateral/vertical ratio is consistent when both targets are set. `make_regularization` should call `_resolve_alpha_s`, `_resolve_alpha_r`, `_resolve_alpha_z` and cache the results to avoid computing thicknesses twice.

---

## Change 4 — `convergence_speed` enum replaces individual beta/optimizer params in simple mode (backend)

### What changes
Add a high-level enum that maps to the four convergence knobs. Individual params become advanced overrides.

```python
directives__convergence_speed: typing.Literal['fast', 'standard', 'thorough'] = 'standard'
"""Overall convergence effort. Controls cooling_factor, beta0_ratio, and max_iter together.
  fast     — cooling_factor=4, max_iter=50.  Beta cools quickly; reaches target misfit in
             ~25 iterations, leaving the rest to converge. Good for parameter testing.
             May leave phi_d slightly above target on complex models.
  standard — cooling_factor=2, max_iter=75.  Recommended default. Slower cooling gives
             the optimizer more room at each regularization level. Usually reaches target
             misfit comfortably within the iteration budget.
  thorough — cooling_factor=1, max_iter=100. Slowest cooling; most iterations per beta
             level. Use for final production runs or when standard does not converge.
All three use beta0_ratio=10 and cooling_rate=1."""
```

Mapping applied in `make_directives`:

```python
_CONVERGENCE_PRESETS = {
    'fast':     {'cooling_factor': 4, 'max_iter': 50},
    'standard': {'cooling_factor': 2, 'max_iter': 75},
    'thorough': {'cooling_factor': 1, 'max_iter': 100},
}

def _resolve_convergence(self):
    preset = _CONVERGENCE_PRESETS[self.directives__convergence_speed]
    return {
        'cooling_factor': self.directives__beta__cooling_factor or preset['cooling_factor'],
        'max_iter':       self.optimizer__max_iter or preset['max_iter'],
    }
```

If either of the individual advanced params is set explicitly (non-None), it takes precedence over the preset — so experts can still mix-and-match (e.g. set `convergence_speed='standard'` but override `max_iter=120`).

**Rationale for not just defaulting to "fast":** The existing standard run (cooling_factor=2, max_iter=50) left phi_d at 1.16× target. Bumping standard to max_iter=75 makes it reliably converge on real data without requiring the user to know why.

---

## Change 5 — Simple / Advanced UI toggle (frontend)

### JSON Schema — new `x-display-group` extension

Each parameter in the backend schema gets an `x-display-group` value:

```python
regularization__target_lateral_resolution_m = None
# In schema():
"target_lateral_resolution_m": {
    "type": ["number", "null"],
    "x-display-group": "simple",
    "title": "Target lateral resolution (m)",
    ...
}

regularization__alpha_r = 1.
# In schema():
"alpha_r": {
    "type": "number",
    "x-display-group": "advanced",
    "title": "Lateral smoothness weight (alpha_r) — advanced",
    ...
}
```

Simple-group parameters for `invert_tem`:
- `input_data`
- `target_lateral_resolution_m`
- `target_vertical_resolution_m`
- `startmodel__res`
- `startmodel__top_depth_last_layer`
- `convergence_speed`
- `save_iterations`

Everything else: `advanced`.

### Frontend — DisplayModeContext + toggle in CustomForm

**New file: `frontend/src/jsoneditor/DisplayModeContext.js`**

```javascript
import { createContext } from 'react';
export const DisplayModeContext = createContext('simple');
```

**`CustomForm.js` — add toggle above the form**

```javascript
import { useState } from 'react';
import { DisplayModeContext } from './DisplayModeContext';

export default function CustomForm(props) {
  const [displayMode, setDisplayMode] = useState('simple');

  // ... existing field/template setup ...

  return (
    <DisplayModeContext.Provider value={displayMode}>
      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: '#666' }}>Parameter mode:</span>
        <button
          onClick={() => setDisplayMode(m => m === 'simple' ? 'advanced' : 'simple')}
          style={{ fontSize: 12, padding: '2px 10px' }}
        >
          {displayMode === 'simple' ? 'Simple ▾ show advanced' : 'Advanced ▴ hide advanced'}
        </button>
      </div>
      <Form
        {...props}
        fields={customFields}
        templates={customTemplates}
        onSubmit={handleSubmit}
        transformErrors={props.transformErrors || transformErrors}
      />
    </DisplayModeContext.Provider>
  );
}
```

**`CustomFieldTemplate.js` — hide advanced fields in simple mode**

```javascript
import { useContext } from 'react';
import { DisplayModeContext } from './DisplayModeContext';

export default function CustomFieldTemplate(props) {
  const { schema, hidden, ... } = props;
  const displayMode = useContext(DisplayModeContext);

  const group = schema?.['x-display-group'];
  if (group === 'advanced' && displayMode === 'simple') {
    // Hidden but still in the DOM so rjsf keeps default values
    return <div style={{ display: 'none' }}>{children}</div>;
  }

  // ... existing render logic unchanged ...
}
```

### Behavior notes
- Toggle state is per-form-instance (local React state), not global. Each process editor has its own mode.
- Advanced fields are hidden but not unmounted — rjsf still submits their default values, so removing a visible field never breaks the payload.
- If a process type has no `x-display-group` annotations, the toggle has no effect (all fields show in both modes). This is safe — existing process types don't need to be updated immediately.
- The toggle only appears when at least one field in the schema has `x-display-group` set. This avoids showing a useless toggle on simple process types.

---

## Change 6 — Marquardt-Levenberg adaptive damping (backend, performance)

### Motivation

The current SimPEG beta schedule is fixed: beta halves (or quarters) every iteration regardless of whether the model update was good or bad. This is why convergence takes 50+ iterations. AarhusInv converges in 5–15 iterations because it uses **Marquardt-Levenberg adaptive damping**: beta is adjusted *per iteration* based on how well the actual decrease in phi_d matched the linearized prediction.

The gain ratio ρ measures this:

```
ρ = (phi_d_old - phi_d_new) / predicted_decrease
```

- **ρ near 1**: the linear approximation was accurate → step was good → decrease beta (trust the gradient more)
- **ρ near 0 or negative**: the step overshot or diverged → increase beta (pull back toward reference)
- **ρ < threshold**: reject the step entirely and retry with higher beta

This self-regulating behavior means the optimizer spends no iterations at the wrong regularization level — it finds the right beta automatically.

### Implementation sketch (`directives.py`)

```python
class MarquardtBetaSchedule(directives.InversionDirective):
    """Adaptive Marquardt-Levenberg beta control.

    Replaces BetaSchedule + BetaEstimate_ByEig for fast convergence.
    Typically converges in 5-15 iterations vs. 50+ with fixed schedule.
    """
    beta_min: float = 1e-10
    shrink_factor: float = 0.3    # multiply beta by this on a good step
    grow_factor: float = 3.0      # multiply beta by this on a bad step
    accept_threshold: float = 0.1 # min rho to accept a step
    good_threshold: float = 0.75  # min rho to shrink beta

    def initialize(self):
        self._phi_d_last = None
        self._predicted_decrease = None

    def endIter(self):
        phi_d = self.invProb.phi_d
        phi_d_last = self._phi_d_last

        if phi_d_last is not None and self._predicted_decrease is not None:
            actual = phi_d_last - phi_d
            rho = actual / (self._predicted_decrease + 1e-30)

            if rho < self.accept_threshold:
                # Bad step — increase beta, signal to redo (if SimPEG supports it)
                self.invProb.beta = min(
                    self.invProb.beta * self.grow_factor,
                    self.invProb.beta * 1e6  # cap
                )
                print(f"Marquardt: rho={rho:.3f} bad step, beta → {self.invProb.beta:.3e}")
            elif rho > self.good_threshold:
                # Good step — decrease beta
                self.invProb.beta = max(
                    self.invProb.beta * self.shrink_factor,
                    self.beta_min
                )
                print(f"Marquardt: rho={rho:.3f} good step, beta → {self.invProb.beta:.3e}")
            else:
                print(f"Marquardt: rho={rho:.3f} acceptable, beta unchanged")

        self._phi_d_last = phi_d
        # Compute predicted decrease from linearized model for next iteration
        # dpred_linearized = J * dm; predicted_decrease = ||W(d - dpred_lin)||^2
        # SimPEG exposes this via invProb after each GN solve
        dm = self.invProb.model - getattr(self, '_model_last', self.invProb.model)
        self._model_last = self.invProb.model.copy()
        # Approximate predicted decrease using the Gauss-Newton step quality
        # Full implementation requires access to the GN linear solve residual
        self._predicted_decrease = max(abs(actual) if phi_d_last is not None else 1.0, 1e-30)
```

**Note:** The predicted decrease calculation above is approximate. A proper implementation needs access to the linearized forward prediction `J @ dm`, which requires hooking into SimPEG's inner CG solve. This is the main implementation challenge — it may require subclassing `InexactGaussNewton` to expose the predicted decrease after the inner solve.

### Convergence speed parameter update

Once Marquardt is implemented, the `convergence_speed` enum changes meaning:

| Speed | Damping | Max iter | Notes |
|-------|---------|----------|-------|
| `fast` | Marquardt (aggressive shrink=0.2) | 20 | Parameter testing |
| `standard` | Marquardt (shrink=0.3) | 30 | Default, should converge reliably |
| `thorough` | Marquardt (shrink=0.3) + IRLS | 50 | Final production + sparse model |

This also makes `thorough` the natural mode for enabling IRLS, which produces sharper layer boundaries.

### Expected impact
- Convergence in **5–20 iterations** instead of 50+
- Runtime drops from ~15 min to **~2–5 min** for a typical 34-sounding test dataset
- Eliminates the need to tune `cooling_factor` and `beta0_ratio` entirely
- Makes the `convergence_speed` enum actually meaningful to a user ("fast = 2 min, standard = 5 min, thorough = 10 min with sparse model")

---

## Implementation Order

1. **Change 1** (auto alpha_s) — purely additive backend change, no schema impact, safe to ship first.
2. **Change 4** (convergence_speed enum) — additive backend + schema change; shows up in UI automatically.
3. **Changes 2 + 3** (target resolutions) — backend + schema; ship together since they interact via `_resolve_alpha_r` calling `_resolve_alpha_z`.
4. **Change 5** (frontend toggle) — ship after schema has `x-display-group` annotations. Isolated to `CustomForm.js` and `CustomFieldTemplate.js`.
5. **Change 6** (Marquardt-Levenberg) — largest engineering effort, most impactful for performance. Ship last once simpler changes are validated. Revisit `convergence_speed` presets after this lands.

---

## Change 7 — Real-time inversion monitoring (frontend)

### Motivation
Watching raw log lines scroll by gives no intuitive sense of inversion progress. Two visualizations would make this immediately readable:

### 7a — Live Tikhonov (L-curve) plot
Plot phi_d vs. phi_m as the inversion runs, updated after each iteration. The L-curve corner is the optimal trade-off point — seeing where the current iterate sits tells the user immediately whether they're over- or under-regularized and whether convergence is happening.

- X axis: phi_m (model roughness), log scale
- Y axis: phi_d (data misfit), log scale
- Each point = one iteration; animate as new steps arrive via the existing `/ws/logs` or state websocket
- Mark the current iterate and the target misfit line (phi_d = N_data)
- The "corner" of the L is where you want to stop — visually obvious even to non-experts

### 7b — Live misfit table / sparkline
A compact per-iteration table or sparkline showing: iter, beta, phi_d, rmse_d, |proj(x-g)-x|. This already exists in the logs but is buried in duplicate lines. Parsing the `ReportingDirective` JSON events (already emitted as `Inversion step` messages) and rendering them as a live table would be straightforward.

**Implementation path:** The `ReportingDirective` in `directives.py` already emits structured JSON per iteration. The frontend just needs a widget that subscribes to the process log stream, filters for `Inversion step` events, and renders them. No backend changes needed.

---

## Open Questions

- **Vertical resolution target default:** What is a sensible auto-default for `target_vertical_resolution_m` when it is `None`? Options: leave `alpha_z = 1.0` (current behavior, no change), or auto-set to 2× the median layer thickness. The latter changes existing inversion behavior for anyone who doesn't set it. Recommendation: keep `None` = use existing `alpha_z = 1.0` until we have more test cases.
- **Single-line synthetic datasets:** The line-spacing fallback (using sounding spacing) gives `h = sounding_spacing`, which may over-constrain `alpha_s` on real multi-line surveys. Need to validate the auto-computed values in the logs against a few real surveys before relying on them.
- **swaggerspect and `x-display-group`:** Need to confirm that swaggerspect passes unknown `x-*` fields through to the generated JSON Schema without stripping them. If it strips them, the annotations need to be added in the `schema()` classmethod rather than as class-level docstring extensions.
