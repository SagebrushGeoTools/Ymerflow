# Nagelfluh Development Plan

This document outlines planned features and tasks for the Nagelfluh geophysics data processing application. Each section provides enough context to serve as a starting point for an implementation session.

---

## 3. 3D Gridding Process

**Goal**: Convert 2.5D flightline resistivity "curtains" into full 3D resistivity volume grids.

**Overview**:
Multiple parallel or intersecting flightlines each have 2D resistivity cross-sections. Gridding interpolates between curtains to create a regular 3D (X, Y, Z) resistivity volume.

**Input**:
- Multiple resistivity model datasets (from inversion or model simulator)
- Each curtain has: X (distance along flightline), Z (depth), resistivity values
- Each curtain has geographic position/path

**Output**:
- 3D regular grid with resistivity values
- Format TBD (msgpack? NetCDF? VTK?)

**Key questions to resolve**:
- **Interpolation method**: Between flightlines (perpendicular direction)
  - Options: kriging, IDW, natural neighbor, linear interpolation
  - Consider computational cost vs. accuracy
- **Grid specification**:
  - Regular XYZ grid with user-defined resolution?
  - Extent: automatic from input data or user-specified bounding box?
  - Vertical discretization: uniform or match input layer structure?
- **Handling gaps**: Areas far from any flightline
  - Extrapolate? Mark as no-data? Distance threshold?
- **Output format**: Best format for 3D volumes
  - Continue using libaarhusxyz msgpack?
  - NetCDF (standard for gridded geoscience data)?
  - VTK (good for 3D visualization)?

**Implementation notes**:
- New process type in `aem_processes/`
- Schema should allow multiple input datasets (array of dataset URLs)
- Grid parameters in schema: resolution, extent, interpolation method
- Consider performance for large grids

**Future extension**:
- Could also support data gridding (2D maps from scattered XY data)
- Start with 3D resistivity gridding, add 2D later if needed

---

## 4. 3D Visualization System

**Goal**: Comprehensive 3D visualization supporting multiple geometry types with interactive slicing.

**Data types to visualize**:
1. **3D resistivity grids** - Voxel rendering of volumes (from gridding process)
2. **Resistivity curtains** - 2.5D flightline cross-sections positioned in 3D space
3. **Raw AEM data** - dB/dt values mapped to vertical position above ground (with visual scaling)
4. **Satellite imagery on DTM** - Terrain/elevation models with draped imagery texture
5. **Cross-sectioning** - Slice through all objects with arbitrary planes to see internal structure

**Key requirements**:
- Multiple layer types in single 3D view
- Interactive controls: rotation, zoom, pan
- Slicing planes to view cross-sections
- Good performance with large datasets
- Proper coordinate system handling (geographic or projected)

**Technology options to investigate**:

| Option | Pros | Cons | Notes |
|--------|------|------|-------|
| **Cesium** | • Built for 3D geospatial<br>• Handles terrain/imagery natively<br>• 3D globe + flat maps<br>• Mature, feature-rich | • Large bundle size (~2MB+)<br>• Commercial licensing for some features<br>• Learning curve<br>• May be overkill for 2D plots | Could serve both 3D plots AND map underlays (#7) |
| **deck.gl** | • WebGL-first (excellent performance)<br>• Designed for large datasets<br>• Good 2D/3D support<br>• Integrates with map libraries<br>• MIT license | • Less geospatial-specific than Cesium<br>• Terrain/DTM support may need custom work<br>• Volume rendering? | Strong candidate, especially if pursuing WebGL-first approach for all plotting (#6) |
| **three.js + react-three-fiber** | • Maximum flexibility<br>• Lighter weight<br>• Full control over rendering<br>• Good React integration | • More implementation work<br>• Need to handle projections/tiles manually<br>• Build geospatial features from scratch | Best for custom visualizations, more work for standard geospatial features |
| **Hybrid approach** | • Best tool for each job<br>• Flexibility | • Integration complexity<br>• Multiple dependencies<br>• Larger bundle | E.g., Cesium for terrain/imagery, three.js for custom vis |

**Questions to resolve during investigation**:
- Is unified 3D geospatial platform (Cesium) worth the bundle size?
- Can Cesium handle custom visualizations (resistivity curtains, AEM data mapping)?
- Does chosen solution support WebGL-first data loading (typed arrays → GPU buffers)?
- How does slicing work in each framework?
- Performance benchmarks with realistic dataset sizes

**Architecture considerations**:
- New "3DView" widget that can show multiple layers?
- Layer configuration system similar to PlotView's elements?
- How to add/configure layers (UI for selecting datasets, setting parameters)?
- Integration with map widget for 2D/3D switching?

**Overlap with #6 (Alternative plotting frameworks)**:
- Both need high-performance WebGL rendering
- May influence choice of plotting framework overall
- Consider unified approach vs. different tools for 2D and 3D

---

## 5. Plot Cleanup - Line Gaps Bug

**Goal**: Fix bug where lines between consecutive points with different sign or `inuse` flag create visual "holes" in data.

**Problem**:
Current plotting code filters out points (e.g., negative values, `inuse=false`), then draws lines between remaining points. This creates gaps/holes where filtered points were located.

**Root cause**:
Likely in `PlotView.js` or plot element rendering code. The line trace generation doesn't handle discontinuities when points are filtered out.

**Solution approaches**:
1. **Break lines into segments**: Detect when consecutive valid points have filtered points between them, create separate line traces for each continuous segment
2. **Filter differently**: Apply filters at rendering level (set color to transparent) rather than removing points
3. **Null values**: Insert `null` values in traces at discontinuities (Plotly handles this)

**Implementation**:
- Locate line rendering code in `PlotView.js` and plot elements
- Identify where filtering occurs
- Implement proper segmentation or null insertion
- Test with data that has mixed signs and `inuse` flags

**Test cases**:
- Data with alternating positive/negative values
- Data with scattered `inuse=false` flags
- Verify lines are continuous where they should be, broken where they shouldn't

---

## 6. Alternative Plotting Frameworks Investigation

**Goal**: Investigate high-performance plotting alternatives that use WebGL-first architecture for large datasets.

**Core problem with Plotly**:
Plotly does extensive data processing/rewriting in JavaScript, which is slow for large datasets. Too much CPU work before GPU can render.

**Ideal architecture**:
- Load typed arrays directly into WebGL buffers (single function call, no JS loops)
- Compile plot parameters/filters into GLSL shaders
- All transformations and rendering happen on GPU
- Minimal JavaScript overhead

**Frameworks to investigate**:

### deck.gl
- **Pros**: WebGL-first, designed for large datasets, good geospatial support, MIT license
- **Cons**: Learning curve, may need custom layers for scientific plots
- **Fit**: Strong candidate, especially combined with #4 (3D plots)

### regl
- **Pros**: Functional WebGL wrapper, very fast, small size
- **Cons**: Lower-level, need to build plotting primitives
- **Fit**: Good foundation for custom plotting layer

### Plotly.js WebGL traces
- **Pros**: Already using Plotly, familiar API
- **Cons**: Still has JS overhead, may not solve core problem
- **Fit**: Quick win if it works, but may not be enough

### Custom WebGL solution
- **Pros**: Total control, exactly what we need
- **Cons**: Most implementation work, maintenance burden
- **Fit**: Worst case fallback

### visx with WebGL layer
- **Pros**: React-friendly, good for 2D charts
- **Cons**: Primarily SVG, WebGL would be custom addition
- **Fit**: Maybe for small/medium datasets, not for large

**Evaluation criteria**:
1. **Performance**: Benchmark with realistic dataset sizes (e.g., 100k-1M points)
2. **API**: How easy to port existing plot elements?
3. **Bundle size**: Impact on app load time
4. **Maintainability**: Community support, documentation, learning curve
5. **Flexibility**: Can it handle scientific plotting needs (multi-axis, units, custom elements)?

**Questions to answer**:
- Replace Plotly entirely, or use WebGL framework only for large datasets?
- Can chosen framework handle both 2D plots and 3D visualization (#4)?
- Integration strategy: gradual migration or big switchover?

**Deliverable**:
- Technical evaluation document with recommendations
- Proof-of-concept with one plot element ported to top candidate
- Performance comparison benchmarks

**Relationship to other tasks**:
- Closely tied to #4 (3D plots) - may want unified solution
- Affects all plotting in the app long-term

---

## 7. Map Underlays and WMS Server

**Goal**: Support external and internal map underlays (basemaps, satellite imagery, geological maps) via WMS/WMTS.

**Requirements**:

### External WMS/WMTS servers
- Configure URLs to external tile services
- Examples: OpenStreetMap, USGS National Map, geological surveys
- UI to add/configure external WMS sources
- Layer selection, opacity control

### Internal WMS server
- **Automatic GeoTIFF publishing**:
  - When GeoTIFF dataset is created/uploaded, automatically register with WMS server
  - Add WMS URL to dataset metadata sent to client
  - Seamless integration with dataset/process system
- **Use cases**:
  - Survey orthophotos
  - Gridded resistivity maps (2D slices from 3D grids)
  - Derived products (e.g., depth to bedrock maps)

**Architecture questions**:

### WMS server implementation
- **Options**:
  - **MapServer**: Fast, C-based, mature, requires Apache/FastCGI
  - **GeoServer**: Java-based, feature-rich, heavier, good admin UI
  - **TiTiler** or **titiler-pgstac**: Python-based, modern, COG-native, FastAPI integration
  - **Custom FastAPI endpoint**: Lightweight, full control, more work
- **Recommendation**: Investigate TiTiler (Python/FastAPI, good fit with existing backend)

### Registration workflow
- How are GeoTIFFs registered with WMS?
  1. **Automatic on dataset creation**: Process that creates GeoTIFF also registers it
  2. **Background watcher**: Monitor dataset storage, auto-register new GeoTIFFs
  3. **Manual registration**: User action to publish dataset as WMS layer
- Should support all three?

### Performance
- Caching strategy (tile caching, COG for efficient access)
- Pre-generate tiles or on-demand?
- Storage location for tiles/COGs

### Frontend integration
- Map widget configuration for base layers
- Layer switcher UI (base layer, overlays, opacity)
- Integration with 3D view (#4) if using Cesium/deck.gl

**Overlap with #4 (3D plots)**:
- If using Cesium: built-in WMS/WMTS support, terrain/imagery handling
- If using deck.gl: can integrate with map libraries (MapLibre, Leaflet) for base layers
- May influence technology choice

**Implementation steps**:
1. Evaluate WMS server options, choose one
2. Set up WMS server (Docker container in dev environment)
3. Implement GeoTIFF registration workflow
4. Update backend to include WMS URLs in dataset metadata
5. Frontend: configure map widget to use WMS layers
6. Add UI for external WMS sources

---

## 8. Manual Processing QC Editor

**Goal**: Interactive editor for manually refining AEM data quality control by toggling in-use flags for soundings and gates.

**Background**:

### AEM data structure
- **Soundings**: Individual measurements taken ~every 75 meters as sensor flies
- **Gates**: Time series samples (TEM decay curve) in each sounding, each with dB/dt value (intensity)
- **Data array**: 2D (soundings × gates) with dB/dt intensity values
- **In-use flags**: 2D boolean array (same shape as data) indicating which measurements are valid

### Workflow
1. Import raw AEM data
2. `processing_process.py` automatically sets initial in-use flags (removes bad/noisy data)
3. **Manual QC** (this feature): User reviews automated flags, manually toggles problematic soundings/gates
4. Flagged data excluded from inversion

**Interface requirements**:

### Tri-state system
For each sounding/gate, user can set one of three states:
- **Set in-use = OFF**: Flag this data as bad (exclude from processing)
- **Set in-use = ON**: Flag this data as good (include in processing)
- **Leave UNCHANGED**: Keep original value from input dataset

### Visualization
- Display 2D heatmap/plot of data with current flags
- X-axis: Sounding index (or distance along flightline)
- Y-axis: Gate index (or time)
- Color: dB/dt intensity (or log scale)
- Overlay: Show current in-use flags (e.g., grayed out or marked)

### Interaction
- **Selection tools**:
  - Click individual cells (sounding/gate)
  - Rectangular selection (drag to select region)
  - Select entire sounding (all gates)
  - Select entire gate (all soundings)
  - Maybe: Polygon/lasso selection
- **Actions**:
  - Toggle selected to OFF/ON/UNCHANGED (keyboard shortcuts or buttons)
  - Undo/redo support

### Integration
- **Work with channel plot**: Integrate with existing plotting system
  - Could be a new widget type ("QCEditor")
  - Or extend PlotView with QC mode
- **Display alongside data plots**: See impact of flagging on downstream analysis

**Technical implementation**:

### Data handling
- Load existing dataset with in-use flags (or default to all `true` if missing)
- Store current state (original flags + user changes)
- Generate diff file on save

### Diff file generation
- Use `libaarhusxyz` diff functionality (see `deps/libaarhusxyz/`)
- Diff file contains only the changes to in-use flags
- Apply diff to original dataset to create modified dataset

### Output
- **New dataset**: Original data + modified in-use flags
- **Or diff dataset**: Diff file that can be applied to original
- Link to original dataset in metadata (provenance)

**UI considerations**:
- Performance with large datasets (thousands of soundings × dozens of gates)
  - Use canvas/WebGL for rendering
  - Consider virtualization for very large datasets
- Visual feedback: clearly show what's flagged, what's been changed by user
- Export/save workflow: automatic save? explicit save button?

**Questions to resolve**:
- New widget type or extend existing?
- Canvas-based or use plotting framework?
- Real-time preview of downstream effects (e.g., show what inversion would see)?

---

## Summary and Priorities

### High Priority (Core functionality)
1. **Plot cleanup** (#5) - Bug fix affecting current usability

### Medium Priority (Major features)
2. **Manual QC editor** (#8) - Improves data quality control
3. **3D gridding** (#3) - Enables full 3D modeling

### Investigation/Long-term
4. **3D visualization** (#4) - Major feature, needs tech evaluation first
5. **Alternative plotting frameworks** (#6) - Performance improvements, ties into #4
6. **Map underlays** (#7) - Enhances visualization, overlaps with #4

---

## Notes for Implementation

### General Guidelines
- **Plan before implementing**: Discuss approach and get approval before making changes
- **No server starts**: Frontend and backend already running with auto-reload
- **No git commits**: User handles version control
- **Package installation**: Ask before installing, use `--save`/`--save-dev` for npm
- **Data access patterns**: Examine actual data structures first, prefer direct access over complex abstractions

### Architecture Resources
- Backend: `backend/main.py`, process types in `docker/base-runner/aem_processes/aem_processes/`
- Frontend: `frontend/src/`, widgets register in `App.js`
- Layout system: `frontend/src/flexout/`
- JSON Schema forms: `frontend/src/jsoneditor/`
- Dataset format: libaarhusxyz msgpack (XYZ + GEX)

### Key Libraries
- **Backend**: FastAPI, libaarhusxyz, SimPEG, swaggerspect
- **Frontend**: React, ReactFlow, Plotly, @rjsf/core, react-dnd
- **Potential new**: deck.gl, Cesium, three.js, TiTiler (WMS)
