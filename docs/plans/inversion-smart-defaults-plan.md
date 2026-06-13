# Inversion Smart Defaults and Simple UI — Plan

See [design](../design/inversion-smart-defaults-and-simple-ui.md) for the full design specification.

## Implementation Order

1. **Change 1** (auto alpha_s) — purely additive backend change, no schema impact, safe to ship first.
2. **Change 4** (convergence_speed enum) — additive backend + schema change; shows up in UI automatically.
3. **Changes 2 + 3** (target resolutions) — backend + schema; ship together since they interact via `_resolve_alpha_r` calling `_resolve_alpha_z`.
4. **Change 5** (frontend toggle) — ship after schema has `x-display-group` annotations. Isolated to `CustomForm.js` and `CustomFieldTemplate.js`.
5. **Change 6** (Marquardt-Levenberg) — largest engineering effort, most impactful for performance. Ship last once simpler changes are validated. Revisit `convergence_speed` presets after this lands.

## Open Questions

- **Vertical resolution target default:** What is a sensible auto-default for `target_vertical_resolution_m` when it is `None`? Options: leave `alpha_z = 1.0` (current behavior, no change), or auto-set to 2× the median layer thickness. The latter changes existing inversion behavior for anyone who doesn't set it. Recommendation: keep `None` = use existing `alpha_z = 1.0` until we have more test cases.
- **Single-line synthetic datasets:** The line-spacing fallback (using sounding spacing) gives `h = sounding_spacing`, which may over-constrain `alpha_s` on real multi-line surveys. Need to validate the auto-computed values in the logs against a few real surveys before relying on them.
- **swaggerspect and `x-display-group`:** Need to confirm that swaggerspect passes unknown `x-*` fields through to the generated JSON Schema without stripping them. If it strips them, the annotations need to be added in the `schema()` classmethod rather than as class-level docstring extensions.
