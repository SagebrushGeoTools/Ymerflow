# FlowView — Version Selection & Filtering Logic

## Implementation plan

### Step 1 — Delete existing logic

All current filtering and propagation code is flawed and must be removed before
reimplementing. Delete the following blocks from
`frontend/src/widgets/FlowView/index.js`:

- `propagateVersions` function (lines 70–101)
- The `useEffect` that initialises versions and calls `propagateVersions`
  (lines 50–129)
- `selectedVersionsRef` and `processesRef` refs used only by the above
  (lines 131–137)
- `handleVersionChange` callback (lines 139–179)
- Active-process sync block (lines 220–225)
- Visible-processes filter / BFS traversal (lines 250–296)
- Hidden-flag logic inside node/edge generation (lines 298–389, the parts
  that gate on visibility)
- Filter toggle handler (lines 391–398)

Keep `selectedVersions` and `selectedFilterTagIds` state declarations
(lines 21–22) — they are the right shape; only the logic that drives them is
being replaced.

In `frontend/src/widgets/FlowView/ProcessNode.js`, remove the unfiltered
version list from the `<select>` (lines 138–150); it will be replaced in
step 5.

### Step 2 — Implement visibility computation

Add a pure function (no side-effects, no hooks) `computeVisibleVersions(processes, selectedFilterTagIds)`:

1. If `selectedFilterTagIds` is empty, every version of every process is
   visible — return early with a full set.
2. Otherwise, seed the visible set with every version that has **all** of the
   filter tags.
3. Expand transitively: for each visible version, walk its `dependencies`
   array and mark each `{ source_process_id, source_process_version }` as
   visible. Repeat until no new entries are added (BFS or iterative DFS, order
   does not matter here).
4. Return a `Map<processId, Set<versionNumber>>` of visible versions, and
   derive a `Set<processId>` of visible processes (those with at least one
   visible version).

### Step 3 — Implement the two-sweep propagation

Add a pure function `propagate(processes, startProcessId, startVersion, visibleVersions)` that returns a new `selectedVersions` map:

**Upward DFS** from `(startProcessId, startVersion)`:

- Look up the version object. Iterate its `dependencies` array in order.
- For each dependency, if `source_process_version` is visible (per
  `visibleVersions`), set `selectedVersions[source_process_id] =
  source_process_version` and recurse into that process/version.
- If the version is not visible, stop — do not recurse further along that
  branch.

**Downward DFS** from `(startProcessId, startVersion)`:

- Find all processes that have at least one version with a dependency on
  `startProcessId` at `startVersion`. Sort them by process id.
- For each, find the **latest** visible version (highest version number) that
  has such a dependency. If found, set it in `selectedVersions` and recurse
  downward from that process/version. If not found, stop (the process remains
  free-floating).
- Do **not** trigger an upward sweep from a newly selected downstream node.

Both sweeps track a visited set of `processId` strings to prevent revisiting.

### Step 4 — Implement initialisation

Add a function `initialise(processes, visibleVersions, activeProcess)` that
produces a fresh `selectedVersions` map:

1. Find all sinks (processes no other process depends on). Sort by process id.
2. For each sink in order, pick its latest visible version and call
   `propagate()`, merging results (later sinks overwrite earlier ones for
   shared upstreams).
3. If `activeProcess` exists and `activeProcess.version` is visible, call
   `propagate()` from `(activeProcess.processId, activeProcess.version)` and
   merge, overwriting the baseline.

### Step 5 — Wire up with hooks and callbacks

In `index.js`:

- Run `computeVisibleVersions` as a `useMemo` on `[processes,
  selectedFilterTagIds]`.
- Run `initialise` inside a `useEffect` on `[processes, visibleVersions]`,
  writing the result to `selectedVersions`.
- Replace `handleVersionChange` with a callback that calls `propagate()` from
  the user-selected `(processId, version)` and writes the result to
  `selectedVersions`. If the changed process is the current `activeProcess`,
  also update `activeProcess.version` to the newly selected version. Both
  updates must happen in the same React render batch (same event handler) so
  that the activeProcess sync effect never sees a state where the two values
  differ transiently and re-triggers a stale propagation.
- Replace the active-process sync with a `useEffect` on `[activeProcess,
  visibleVersions]`: if `activeProcess.version` is visible and differs from
  `selectedVersions[activeProcess.processId]`, call `propagate()` and write
  the result.
- Replace the filter toggle handler with a simple setter for
  `selectedFilterTagIds` (re-init is triggered automatically by the
  `visibleVersions` change).

In `ProcessNode.js`:

- Receive the `Set<versionNumber>` of visible versions for this process as a
  prop and filter the `<select>` options to only those versions.

### Step 6 — Verify

- No active filter: all versions visible, latest-version baseline selected,
  activeProcess chain overrides it.
- Filter applied: only tagged versions (and their transitive upstreams) appear
  in dropdowns; selectedVersions updates to match.
- User changes a version: upward sweep locks exact dependency versions,
  downward sweep picks latest compatible downstream versions.
- activeProcess version change: sweep runs if visible, ignored if not.

## Data model recap

- A **process** has an `id`, a `name`, a `type`, and an ordered array of
  **versions**.
- A **version** has a `version` number, an array of **dependencies**, an
  `outputs` map, a `state`, and `tags`. The versions array is always sorted
  ascending by version number; "latest" means the highest version number
  (i.e. the last element).
- A **dependency** links a version to an upstream output:
  `{ source_process_id, source_process_version, source_dataset_name, target_param_name }`.
  It means "this version consumes version `source_process_version` of process
  `source_process_id`, taking its `source_dataset_name` output into the
  `target_param_name` parameter."
- `selectedVersions` is the widget's core state: a map of `processId → versionNumber`,
  one chosen version per process.


## Filtering logic

Filtering hides/shows nodes and edges based on the active tag filter
(`selectedFilterTagIds`). A filter change triggers the full initialization
sequence, which re-selects versions based on what is visible under the new
filter (updating `selectedVersions`). Nothing is persisted to the server as
a result — `selectedVersions` is ephemeral widget state.

Logic for what processes and versions to show when a filter is active:

* Any version that has all tags in the filter is visible
* Any version that is a dependency of a visible version, is itself visible (this is transitive)
* Any process that has at least one version visible, is itself visible

Invisible versions are NOT shown in the version dropdown on a process. If the active process's version (from global app state) is invisible under the current filter, no process gets the "active process" blue border.


## Propagation logic

When a version is selected by the user on a process, the versions selected on other processes need to also be updated to make the graph consistent. This happens on the filtered graph, and after filtering, when a user changes the value in a version dropdown.

The graph is a DAG, so this can be done with two DFS passes, each starting from the touched process. Think of the touched process as the root of a tree, with two separate one-directional sweeps that never backtrack:

* **Upward sweep** — from the touched process, follow dependency edges towards sources. Only upstream nodes are visited going up; we never turn around and go back down from a visited upstream node. Children are visited in the order they appear in the version's `dependencies` array.
* **Downward sweep** — from the touched process, follow reverse-dependency edges towards sinks. Only downstream nodes are visited going down; we never turn around and go back up from a visited downstream node. Because there is no explicit array ordering for reverse-dependency edges, downstream processes are visited sorted by process id.

Rules applied at each visited node:
* For dependencies of the current process and version (upward sweep), change them to exactly the version the dependency specifies, if that version is visible under the active filter. If not, do nothing and stop recursion.
* For processes dependent on the current process (downward sweep), select the latest visible version (under the active filter) that depends on the current version of the current process, if there is one. If not, do nothing and stop recursion. The downstream process will then appear "free floating." Note: the newly selected downstream version may have other dependencies (not to the current process) whose selected versions don't match — those connections are also free-floating. Only the dependency that triggered this sweep is guaranteed consistent; no upward sweep is triggered from the newly selected downstream node.

### On initial load

Once the graph is loaded, or when the filter changes, the following steps run in order:

1. Select the latest visible version (under the active filter) on all leaves (sinks: processes with no downstream dependants) and recurse as if they had been selected by the user. This sets a baseline selection for the whole graph. Sinks are processed in a deterministic order (sorted by process id) so that when two sinks require different versions of a shared upstream dependency, the last sink in that order wins consistently.
2. If there's an activeProcess and its version is visible under the active filter, operate as if the user had selected that version from the dropdown on the process. This partially overwrites the baseline for processes in the activeProcess chain; processes outside that chain keep their baseline values. If the activeProcess version is invisible, skip this step (and no process gets the blue border).

### Active-process sync

`activeProcess` is global app state: the process currently open in the process editor and selected in the top toolbar. `activeProcess.version` is the version currently being viewed/edited there. FlowView receives this as external state.

* When `activeProcess` changes, if `activeProcess.version` is visible under the
  active filter and the selected version for that process differs from
  `activeProcess.version`, operate as if the user had selected that version from
  the dropdown on the process. If `activeProcess.version` is invisible, treat it
  as if no process is active: no blue border, no sweep triggered.
* When the user changes the version dropdown on the process that is currently
  `activeProcess`, update `activeProcess.version` to match the newly selected
  version.

## Known issues in the current logic

### Resolved by this redesign

- **Version dropdown not filtered:** `ProcessNode` renders *all* versions in the
  `<select>`, ignoring the active tag filter. → Fixed: invisible versions are
  excluded from the dropdown.
- **Filter does not re-select a matching version:** when a filter is applied and a
  process's selected version doesn't match but another version does, the process
  is hidden instead of switching to a matching version. → Fixed: filter changes
  trigger the full initialization sequence which re-selects based on visible versions.
- **Tags not reflecting selected version:** `TagSelector` needs a key tied to the
  selected version to re-render on version switch. → Fixed via `key` prop tied to
  the selected version.


