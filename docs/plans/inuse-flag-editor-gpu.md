# InUse Flag Editor — GPU Diff Path

## Motivation

After the O(n²) reducer fix, lasso edits still take ~1 s. The remaining latency is from
`plot.update()` triggering `createLayer()` on every edit: ~500 k inuse_state values are
recomputed from JS Map lookups and re-uploaded to the GPU.

The fix is to make the diff GPU-resident so:
1. The selection handler writes directly to GPU textures — no CPU loop, no Map mutations.
2. `createLayer()` never runs on a diff edit — only `plot.scheduleRender()` is needed.
3. The vertex shader reads the diff texture and computes inuse_state on-chip.

---

## New Diff Representation

Replace `inMemoryDiffs[dsName][channel]: Map<gateKey, Map<soundingIdx, 0|1>>` with a
**`DiffColumn`** — a custom `ColumnData` subclass — per (dsName, channel).

`DiffColumn` has the same tile layout as the `inuse_brush` SelectionColumn (one FBO+texture
per gate, N vertices per tile where N = nSegs × 2). It stores a 3-state value per vertex:

| Texel value | Meaning |
|---|---|
| 0.0 | No override (pass-through) |
| 1.0 | Manually enabled |
| 2.0 | Manually disabled |

A single texture per tile is sufficient (no need for two separate enabled/disabled columns).
The texture format is the same 4-packed RGBA float as `SelectionColumn`.

`DiffColumn` lives in a React **ref** on PlotView (not in React state) because it holds live
WebGL objects that must share `plot.regl`'s context. It is keyed by `"${dsName}::${channel}"`.

---

## GPU Blend on Selection

Replace the selection handler's JS loop + `applyInMemoryEdit` with a regl draw call.

For each active ChannelPlot layer with `inUseMode`, and for each tile `t`:

```
framebuffer = diffCol.tiles[t].fbo
draw fullscreen quad:
  u_sel   = inuse_brush selection tile t texture
  u_diff  = current diff tile t texture
  u_value = 1.0 (enable) | 2.0 (disable) | 0.0 (clear)

  fragColor[i] = sel[i] > 0.5 ? u_value : diff[i]
```

After all tiles are drawn, call `plot.scheduleRender()` — no React state update, no
`plot.update()`, no `createLayer()` re-run.

The fragment shader must use the same 4-packed texel layout as `SelectionColumn` so
`sampleColumn` can read back the result correctly in the vertex shader.

---

## ChannelPlot Shader Changes

Remove the CPU-computed `inuse_state` Float32Array attribute. Replace with:

- `in float inuse_raw` — original per-vertex InUse value (0 or 1), still a CPU Float32Array
  from `InUse_${channel}` layer data. This data never changes after load so it only uploads
  once.
- `diff` — the `DiffColumn` for this (dsName, channel), passed as a per-tile texture attribute.

In the vertex shader:

```glsl
float diff_val = sampleColumn(diff, a_pickId);   // 0=none, 1=enabled, 2=disabled
float state;
if      (diff_val > 1.5) state = 3.0;  // manually disabled
else if (diff_val > 0.5) state = 1.0;  // manually enabled
else                     state = inuse_raw > 0.5 ? 0.0 : 2.0;  // auto
vInuseState = state;
```

`inuse_state` is removed as a declared `in` attribute; `inuse_raw` and `diff` replace it.

### Required gladly change

`createLayer` currently accepts `Float32Array` or computed-attribute expression objects as
attribute values. It needs to also accept `ColumnData` instances (including `SelectionColumn`
and the new `DiffColumn`), calling `.resolve(path, regl)` to get the `{ glslExpr, textures }`
injection the same way built-in layer types use `SelectionColumn`. This is a small addition
to `Layer.js`'s attribute resolution loop.

---

## Undo

Snapshots are CPU Float32Array arrays, taken before each GPU draw:

```
snapshot[dsName][channel][t] = readPixels(diffCol.tiles[t].fbo)   // Float32Array
```

Stored in a ref on PlotView (not React state). On undo, re-upload via
`diffCol.upload(snapshot)` and call `plot.scheduleRender()`.

This is slower than the hot path (readPixels is a GPU stall) but undo is rare and
user-initiated so synchronous latency is acceptable.

---

## Edit Statistics for InUseEditor

The InUseEditor widget currently iterates `inMemoryDiffs` Maps to compute counts. With
GPU-resident diffs, counts are maintained as a plain integer React state on ProcessContext:

- Increment by the number of selected vertices after each GPU draw (known from
  `sel.arrays` element count without iterating the full array — just sum non-zero counts,
  which is cheap via `TypedArray.reduce` or tracked during the blend shader dispatch).
- Reset to 0 on save or clear-all.
- Decrement on undo by storing the delta alongside each undo snapshot.

The exact enabled/disabled split shown in the widget ("↑ N enabled, ↓ N disabled") can be
derived cheaply from the action type and delta, or dropped in favour of just a total count.

---

## Save (`saveAllDiffs`)

On save, read back each DiffColumn tile to CPU:

```
arrays[t] = readPixels(diffCol.tiles[t].fbo)   // Float32Array of 3-state values
```

Convert to the existing JSON diff format (sparse gate×sounding entries with values 1/0/NaN),
then call the existing upload + new-process-version logic unchanged.

Readback is a GPU stall but save is user-initiated and infrequent.

---

## ProcessContext Changes

| Item | Before | After |
|---|---|---|
| `inMemoryDiffs` | `Map<gateKey, Map<soundingIdx, 0\|1>>` per dsName+channel | Removed from hot path; kept only as undo snapshot storage in PlotView ref |
| `applyInMemoryEdit` | Reducer dispatch (JS Maps) | Removed; replaced by GPU draw in PlotView selection handler |
| `inUseAction` | React state | Unchanged |
| `undoLastEdit` | Pops Map snapshot from history | Changed to read from PlotView's undo ref; PlotView registers an undo callback with ProcessContext on mount |
| `saveAllDiffs` | Serialises Maps | Changed to read from PlotView's DiffColumns; PlotView registers a save callback with ProcessContext on mount |
| `pendingEditCount` | Computed from Map iteration | Cheap integer React state, updated after each GPU draw |

PlotView registers `{ undo, save }` callbacks with ProcessContext on mount (via a new
`registerDiffCallbacks(dsName, channel, { undo, save })` helper) so InUseEditor can still
trigger them without knowing about GPU objects.

---

## Implementation Steps

1. **`DiffColumn` class** (`frontend/src/widgets/PlotView/DiffColumn.js`)
   - Subclass of `ColumnData`, same tile structure as `SelectionColumn`
   - Constructor: `(regl, tileSizes)`
   - Methods: `clear()`, `upload(arrays)`, `resolve(path, regl)`, `toTexture(regl)`
   - `resolve()` returns `{ glslExpr: 'sampleColumn(path, a_pickId)', textures: ... }`
     identical to `SelectionColumn.resolve()`

2. **GPU blend utility** (`frontend/src/widgets/PlotView/blendDiff.js`)
   - `blendDiff(regl, selCol, diffCol, value)`
   - One regl program (compiled once, cached); draws a fullscreen quad per tile
   - Handles the 4-packed texel format

3. **Gladly: `ColumnData` attribute support in `Layer.js`**
   - In the attribute upload loop, detect `ColumnData` instances and call `.resolve()` to
     get the GLSL injection + texture bindings

4. **PlotView selection handler** — replace JS loop with `blendDiff` call + `scheduleRender()`

5. **ChannelPlot** — replace `inuse_state` Float32Array with `inuse_raw` + `diff` attributes;
   update vertex shader

6. **PlotView** — manage `DiffColumn` ref, register undo/save callbacks with ProcessContext

7. **ProcessContext** — add `registerDiffCallbacks`, `pendingEditCount`; remove
   `inMemoryDiffs` and `applyInMemoryEdit`

8. **InUseEditor** — switch stats display from Map iteration to `pendingEditCount`

---

## What Is Not Changing

- The libaarhusxyz diff JSON format and the save API call
- InUseEditor widget UI and keyboard shortcuts
- The `inUseAction` / `setInUseAction` state in ProcessContext
- ChannelPlot's 4-state visual encoding and fragment shader
- The undo UX (Ctrl+Z still works, just backed by GPU readback instead of Map snapshot)
