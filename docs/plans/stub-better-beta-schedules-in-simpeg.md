# need better beta schedules in simpeg

**GitHub Issue:** #16
**State:** open
**Labels:** none

## Description

_Migrated from deprecated-nagelfluh #20 (originally by @burningsage)_

## Background

The current `invert_tem` beta schedule is fixed: beta halves (or quarters) every
iteration regardless of whether the model update was good or bad. After extensive
testing on LPNNRD2018 line 409001 (501 soundings), we have clear empirical evidence
that this is the primary convergence bottleneck in our workflow.

## Observed behavior

Across 10+ test inversions varying `alpha_z` (0.5, 0.25), starting model
(15, 50, 100 Ω·m), `beta0_ratio` (10, 50, 100), and `cooling_rate` (1, 2), the
result is nearly always the same:

- Inversion stops at **6 iterations** on `tolX` (step size goes to zero)
- Final `rmse_d` consistently stalls at **1.1–1.3**, well above the target of 1.0
- None of the knobs we have access to — `beta0_ratio`, `cooling_rate`,
  `cooling_factor` — meaningfully change this outcome

The one exception was a 100 Ω·m start model that accidentally ran 14 iterations.
The reason: its high initial misfit produced a high starting beta, which gave the
model a slower *effective* cooling schedule by coincidence. This is exactly the
behavior Marquardt-Levenberg would provide automatically.

The integer-only constraint on `cooling_factor` makes manual tuning even more
limited — we cannot try values like 1.3 or 1.5 that most SimPEG workflows use.

## Root cause

The optimizer converges at the current beta level (step size → 0), then beta drops
and the model has to rebuild momentum at the new regularization level. With
`cooling_factor=2` and `cooling_rate=1`, beta has dropped 64× by iteration 6.
There is no feedback mechanism to detect whether the step was good or bad, or to
find the right beta level automatically.

## Proposed fix: Marquardt-Levenberg adaptive damping

Replace the fixed `BetaSchedule + BetaEstimate_ByEig` with an adaptive directive
that adjusts beta per iteration based on the gain ratio ρ:
ρ = (phi_d_old - phi_d_new) / predicted_decrease

- **ρ ≈ 1**: linear approximation was accurate → good step → decrease beta
- **ρ ≈ 0 or negative**: step overshot or diverged → increase beta
- **ρ < threshold**: reject the step entirely and retry with higher beta
This is how AarhusInv converges in 5–15 iterations. A full implementation sketch
is in [`docs/design/inversion-smart-defaults-and-simple-ui.md`](docs/design/inversion-smart-defaults-and-simple-ui.md)
(Change 6).
The main engineering challenge is computing the **predicted decrease** accurately,
which requires access to the linearized forward prediction `J @ dm` after the inner
CG solve. This likely requires subclassing `InexactGaussNewton` to expose that value.
## Expected impact
- Convergence in **5–20 iterations** instead of stalling at 6
- `rmse_d` reaches target (1.0) reliably
- Eliminates the need to tune `cooling_factor`, `beta0_ratio`, and `cooling_rate`
- Makes the `convergence_speed` enum (Change 4 in the design doc) actually
  meaningful: "fast = ~2 min, standard = ~5 min, thorough = ~10 min with sparse model"
- Once implemented, the integer-only `cooling_factor` constraint becomes irrelevant
## References
- Design doc: `docs/design/inversion-smart-defaults-and-simple-ui.md` — Change 6
- Implementation listed as last in the recommended order (after Changes 1–5) due to
  engineering complexity, but is the most impactful single change
