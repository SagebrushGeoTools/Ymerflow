# InUse Flag Manual Editor

## Overview

A UI for manually overriding InUse flags on AEM gate data (dbdt ChannelPlot). Users select points via lasso, apply enable/disable/clear overrides, and save as a libaarhusxyz diff. The diff is applied in-pipeline via a compound filter step.

## Four Visual States

Each gate×sounding cell has one of four states, derived by combining the pre-diff data's InUse column with the current diff:

| State | Source | Visual |
|---|---|---|
| Auto-enabled | InUse=1, no diff entry | No overlay (default) |
| Auto-disabled | InUse=0, no diff entry | Grey tint |
| Manually enabled | Diff entry = 1 | Green tint |
| Manually disabled | Diff entry = 0 | Red tint |

## Components

### 1. Compound Filter (`emeraldprocessing.pipeline_step`)

A new pipeline step type that:
- Takes `input`, `output`, and optional `diff` (storage URL) parameters
- Applies the diff to the input data if `diff` is specified; absent/null = pass-through (equivalent to empty diff)
- Always saves the (possibly modified) intermediate result to `output`

The user manually inserts this step into a processing pipeline at the point where manual InUse editing is desired. Without it there is no stable intermediate dataset to edit against, making edits unreasonable.

### 2. ChannelPlot Layer Extension

The existing ChannelPlot plot layer gains an optional InUse overlay mode.

**On mount/data change:**
- Inspects the current process config for the compound filter step whose output name matches this layer's dataset name
- Loads the diff dataset from that step's `diff` URL (null/absent → treat as empty)
- Renders the four-state overlay on top of normal gate value rendering

**Selection and editing:**
- Gladly lasso selection (shift+drag) produces a boolean ColumnData mask, same length as the plotted data
- The layer maps this mask back to (sounding_index, gate_index) pairs using the existing render column indices
- Applies the user's chosen action (enable / disable / clear) to `ProcessContext.inMemoryDiffs[datasetName]`

### 3. ProcessContext Additions

- `inMemoryDiffs`: `{ [datasetName]: sparseEditState }` — accumulates edits across lasso operations before saving
- Helper to update a dataset's in-memory diff given a set of (sounding, gate) index pairs and a value (1 / 0 / NaN)
- Helper to clear a dataset's in-memory diff

### 4. InUse Editor Widget

A separate widget (distinct from the ChannelPlot layer) that owns the save interaction.

**Toolbar buttons** (always visible, applied to current lasso selection):
- **Enable** — force selected points to InUse=1
- **Disable** — force selected points to InUse=0
- **Clear** — remove selected points from diff (restore pass-through)

**Keyboard shortcuts** (active when editor has focus):
- `E` — Enable
- `D` — Disable
- `C` — Clear

**Save button:**

For each dataset with pending edits in `inMemoryDiffs`:
1. Serialize in-memory edits to libaarhusxyz diff format
2. Create a new version of the diff dataset
3. Update the corresponding compound filter step's `diff` parameter in the process config to reference the new diff URL
4. Create a new version of the processing process

Each dirty dataset is saved independently, producing separate new versions. Saving two datasets in one session creates two new diff dataset versions and updates the process config in two places.

## libaarhusxyz Diff Format (existing)

The existing sparse format is used as-is:
- Only gates that have at least one manually-set sounding are included
- Only sounding indices that have at least one manually-set gate are included
- Non-set values within those sparse slices are NaN
- Values: `1` = force enable, `0` = force disable, `NaN` = pass-through (unset)

## Data Flow

```
Processing pipeline
  └─ compound filter step
       ├─ input: upstream dataset
       ├─ diff: diff dataset URL (optional)
       └─ output: intermediate dataset  ←── ChannelPlot displays this
                                             (pre-diff gate values + diff overlay)
```

The ChannelPlot receives the pre-diff data (gate values as they exist at that pipeline stage, e.g. pre-averaging) plus the diff. This is intentional — edits are made against the actual data at that point, not a later transformed version.

## User Workflow

1. User adds a compound filter step to their processing pipeline at the desired edit point
2. User opens a ChannelPlot pointing at the compound filter's output dataset
3. User opens the InUse Editor widget alongside it
4. User shift+drags to lasso-select gates×soundings in the ChannelPlot
5. User clicks Enable / Disable / Clear (or uses keyboard shortcuts)
6. Repeat 4–5 across multiple areas and/or multiple ChannelPlot layers
7. User clicks Save — new diff and process versions are created
8. Pipeline reruns with the updated diff applied
