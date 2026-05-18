# Plan: Multi-Process PlotView with Combobox Dataset/Column Selection

## Goal

Allow PlotView layers to reference data from any process in the project, not just the currently
active one. Column and dataset references use dot-separated paths: `current.flightlines.mag_nT`
for the active process and `processname.version.datasetname.columnname` for others. Custom
combobox widgets replace static enum dropdowns in the rjsf form editor.

---

## Design Decisions

- **Separator**: `.` (dot) throughout — consistent with gladly's existing `dataset.column`
  convention and DataGroup `_resolve()`.
- **`current` prefix**: Live alias for the active process/version. When the user changes the
  active process, all `current.*` references update automatically. This is a feature.
- **Eagerly loaded**: Only the current process datasets are loaded up front (existing behaviour).
- **Lazily loaded**: All other process datasets load when the user selects or types a complete
  `processname.version.datasetname` path in the combobox.
- **Column loading**: Columns for non-current datasets are not shown until the dataset is
  selected (triggering a load). Process and dataset names across the whole project are
  available immediately (already loaded with `useProcesses`).
- **Two field types**:
  - `x-format: 'datasetPath'` — picks a whole dataset: `"current.flightlines"`.
    Used by custom layer types (FlightlinePlot, ChannelPlot, etc.) that consume an entire
    dataset object rather than individual columns.
  - `x-format: 'expression'` — picks a column path OR a computation object:
    `"current.flightlines.mag_nT"` | `{ histogram: {...} }`.
    Used by gladly's built-in layer types (GridLayer etc.) via `EXPRESSION_REF`.
    Rendered with a toggle: column combobox ↔ computation form.

---

## Changes

### 1. `deps/gladly/src/compute/ComputationRegistry.js`

Add `'x-format': 'expression'` to the `defs.expression` and `defs.expression_opt` objects
produced by `computationSchema()`.

- When `cols.length === 0`: still emit a valid expression schema (not `false`) so the widget
  can render. The anyOf column list will be empty; the combobox fills options from React context.
- When `cols.length > 0`: add `'x-format': 'expression'` alongside the existing anyOf.

This is the only change needed in gladly. It signals to Nagelfluh's rjsf setup that this
field should render as the toggle widget rather than the default anyOf picker.

---

### 2. `frontend/src/widgets/PlotView/index.js` — DataGroup restructuring

**a) Restructure `dataForPlot`**

Current:
```js
const dataForPlot = dc ? dc.toDataGroup() : new DataGroup({});
Object.assign(dataForPlot, fetchedData, { _currentSounding: currentSounding });
```

New: wrap the current process in a `current` child in `_children` (so gladly resolves
`"current.flightlines.mag_nT"` natively), and also set `current` as an own property (so
custom layers can traverse `plot._rawData.current.flightlines`).

```js
const currentGroup = dc ? dc.toDataGroup() : new DataGroup({});
const dataForPlot = new DataGroup({ current: currentGroup });
Object.assign(dataForPlot, {
  current: fetchedData,              // custom layer access: plot._rawData.current.flightlines
  _currentSounding: currentSounding,
});
```

`DataGroup({ current: currentGroup })` puts `currentGroup` in `_children.current`, so gladly
resolves `"current.flightlines.mag_nT"` via its recursive `_resolve()`. The own property
`current: fetchedData` lets custom layers read `plot._rawData.current[datasetName]` via the
shared `resolveDataPath` helper.

**b) Lazy loading of non-current datasets**

Add state `lazilyLoadedData` — a `Map` of `"processname.version.datasetname"` → raw data
object (same shape as `fetchedData` values).

Add a `useEffect` that:
1. Scans all layer parameter values in `config.layers` for strings that match
   `processname.version.datasetname[.column]` (i.e. not starting with `"current"`).
2. For each unloaded path, looks up the dataset URL from `processes`, calls `loadDataset(id)`
   then `datasetObj.fetchData("all")`.
3. Stores the result in `lazilyLoadedData`.

When building `dataForPlot`, merges lazily loaded data into both `_children` (for gladly
column resolution) and own properties (for custom layer access):

```js
for (const [path, rawData] of lazilyLoadedData) {
  // path = "inversion_v2.0.flightlines"
  const [procName, ver, dsName] = path.split('.');
  // own-property chain for custom layers:
  dataForPlot[procName] ??= {};
  dataForPlot[procName][ver] ??= {};
  dataForPlot[procName][ver][dsName] = rawData;
  // _children for gladly's getData():
  // dataForPlot._children[procName]._children[ver]._children[dsName] = Data(...)
}
```

**c) Simplify `get_schema()`**

Remove injection of `schemaData.processes` — the combobox widgets read from `ProcessContext`
directly. Column enumeration in the schema is no longer needed for display; the combobox
handles it dynamically. Pass `null` for the data argument to `Plot.schema()`:

```js
PlotView.get_schema = (data_context = {}) => {
  const gladlySchema = Plot.schema(null, data_context.layoutConfig);
  // ... existing patching unchanged ...
};
```

Remove `datasetProp` from `colorUtils.js` once all layer element files are updated (step 3).

---

### 3. Custom layer elements — update schema and data access (7 files)

All 7 custom layer element files follow the same pattern today:

```js
// schema:
dataset: datasetProp(data),

// createLayer:
const rawData = plot?._rawData ?? data;
const dataset = rawData?.[parameters.dataset];  // e.g. rawData["flightlines"]
```

**Schema change** — replace `datasetProp(data)` with:
```js
dataset: { type: 'string', 'x-format': 'datasetPath' },
```

**createLayer change** — use a shared path resolver:
```js
// New helper in colorUtils.js:
export function resolveDataPath(obj, path) {
  return path ? path.split('.').reduce((o, k) => o?.[k], obj) : undefined;
}

// In every createLayer:
const rawData = plot?._rawData ?? data;
const dataset = resolveDataPath(rawData, parameters.dataset);
// "current.flightlines" → rawData.current.flightlines
```

`ResistivityCurtain` additionally uses `parameters.dataset` to build column-name prefixes
(`parameters.dataset + '.'`). Change this to use only the leaf dataset name:
```js
const dsLeaf = parameters.dataset?.split('.').at(-1) ?? '';
const prefix = dsLeaf ? dsLeaf + '.' : '';
```

Files to update:
- `FlightlinePlot.js`
- `ChannelPlot.js`
- `ResistivityCurtain.js`
- `MagLinePlot.js`
- `SoundingPlot.js`
- `SoundingMarker.js`
- `SoundingResistivityPlot.js`

---

### 4. New: `frontend/src/jsoneditor/DatasetColumnCombobox.js`

Shared combobox component used by both new field types.

**Props**: `value`, `onChange`, `mode` (`'dataset'` | `'column'`)

**Data sources**:
- `processes` from `ProcessContext` — all project processes with their output dataset names.
  Available immediately without any additional loading.
- `fetchedData` from `ProcessContext` — current process raw data; columns available via each
  dataset object's `.columns()` method (gladly Data interface).
- `lazilyLoadedColumns` — local `useState` map of
  `"processname.version.datasetname"` → string[], populated on demand.

**Behaviour**:
- Empty input: show `current.<datasetname>` options in dataset mode, or
  `current.<datasetname>.<column>` options in column mode, sourced from eagerly loaded data.
- Typing: filter across all process names, dataset names, and (for already-loaded datasets)
  column names.
- When input resolves to a complete `processname.version.datasetname` path (≥3 segments,
  first segment ≠ `"current"`): trigger lazy column load via `loadDataset()` +
  `fetchData("all")`, then store column names in `lazilyLoadedColumns` and repopulate options.
- For `current.*`: columns are already in `fetchedData`; no load needed.
- Selection calls `onChange(fullPathString)`.

**Implementation**: plain `<input>` with a filtered dropdown `<ul>` rendered below — no
external combobox library needed. The dataset list is bounded and filtering is synchronous.

---

### 5. New: `frontend/src/jsoneditor/ExpressionField.js`

Custom rjsf field for `x-format: 'expression'` (column path OR computation object).

- Renders a small toggle button beside the input: database/grid icon (column mode) vs.
  `ƒ` function icon (computation mode).
- Infers initial mode from the current value type: `string` → column mode;
  `object` → computation mode.
- **Column mode**: renders `<DatasetColumnCombobox mode="column" ... />`.
- **Computation mode**: renders the standard rjsf anyOf form for the computation schema
  branches (texture/GLSL computations), extracted from the resolved schema's `anyOf`.
- On mode switch: resets value to `""` (column) or `{}` (computation).

---

### 6. New: `frontend/src/jsoneditor/DatasetPathField.js`

Custom rjsf field for `x-format: 'datasetPath'` (whole dataset reference, no toggle).

- Renders `<DatasetColumnCombobox mode="dataset" ... />` directly.

---

### 7. `frontend/src/jsoneditor/CustomStringField.js`

Add detection for `x-format: 'datasetPath'`:
```js
if (schema['x-format'] === 'datasetPath') {
  // render DatasetPathField widget (same pattern as existing DatasetSelector)
}
```

---

### 8. `frontend/src/jsoneditor/CustomForm.js`

Add a custom `SchemaField` wrapper that intercepts `x-format: 'expression'` before rjsf's
default type-based dispatch (which would otherwise send it to `AnyOfField`):

```js
const customFields = {
  StringField: CustomStringField,
  NumberField: CustomNumberField,
  SchemaField: (props) => {
    if (props.schema?.['x-format'] === 'expression') {
      return <ExpressionField {...props} />;
    }
    const { SchemaField: DefaultSchemaField } = getDefaultRegistry().fields;
    return <DefaultSchemaField {...props} />;
  }
};
```

---

## File Summary

| File | Change |
|------|--------|
| `deps/gladly/src/compute/ComputationRegistry.js` | Add `'x-format': 'expression'` to expression defs |
| `frontend/src/widgets/PlotView/index.js` | Restructure DataGroup; add lazy loading; simplify `get_schema()` |
| `frontend/src/widgets/PlotView/colorUtils.js` | Add `resolveDataPath()`; remove `datasetProp()` |
| `frontend/src/widgets/PlotView/elements/FlightlinePlot.js` | Replace `datasetProp` + update data access |
| `frontend/src/widgets/PlotView/elements/ChannelPlot.js` | Same |
| `frontend/src/widgets/PlotView/elements/ResistivityCurtain.js` | Same + fix prefix construction |
| `frontend/src/widgets/PlotView/elements/MagLinePlot.js` | Same |
| `frontend/src/widgets/PlotView/elements/SoundingPlot.js` | Same |
| `frontend/src/widgets/PlotView/elements/SoundingMarker.js` | Same |
| `frontend/src/widgets/PlotView/elements/SoundingResistivityPlot.js` | Same |
| `frontend/src/jsoneditor/DatasetColumnCombobox.js` | **New** — shared combobox component |
| `frontend/src/jsoneditor/ExpressionField.js` | **New** — column/computation toggle field |
| `frontend/src/jsoneditor/DatasetPathField.js` | **New** — dataset-only combobox field |
| `frontend/src/jsoneditor/CustomStringField.js` | Add `datasetPath` x-format detection |
| `frontend/src/jsoneditor/CustomForm.js` | Add `SchemaField` override for `expression` x-format |

---

## Implementation Order

1. **Gladly** (`ComputationRegistry.js`) — unblocks everything; small isolated change.
2. **`colorUtils.js`** — add `resolveDataPath`; keep `datasetProp` until layer files are done.
3. **All 7 layer element files** — schema + data access updates; can be done in parallel.
4. **`PlotView/index.js`** — DataGroup restructuring only (no lazy loading yet). Verify
   current-process plots work end-to-end before proceeding.
5. **`DatasetColumnCombobox.js`** — build the combobox against current-process data only first.
6. **`ExpressionField.js`** and **`DatasetPathField.js`** — wire up the new widgets.
7. **`CustomStringField.js`** and **`CustomForm.js`** — register the new fields.
8. **Lazy loading** in `PlotView/index.js` — add the non-current process data path last,
   once the rest is verified working.
9. Remove `datasetProp` from `colorUtils.js`.
