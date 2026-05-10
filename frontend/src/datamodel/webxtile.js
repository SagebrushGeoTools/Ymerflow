import { WebxtileLoader } from 'webxtile';
import { ArrayColumn } from 'gladly-plot';
import { Dataset } from './dataset';
import { parseCrsCode, crsToQkX, crsToQkY, registerAxisQuantityKind } from 'gladly-plot';

const _CF_TO_QK = {
  electrical_resistivity: 'log_resistivity',
  depth_of_investigation:  'doi_m',
};
const _UNITS_TO_QK = { 'ohm m': 'log_resistivity' };
const _COL_TO_QK   = {
  resistivity:  'log_resistivity',
  doi_layer:    'doi_m',
  conductivity: 'conductivity_sm',
  z_top:        'elevation_m',
  z_bottom:     'elevation_m',
};

function _cfAttrsToQuantityKind(attrs) {
  const sn = attrs?.standard_name ?? '';
  if (_CF_TO_QK[sn]) return _CF_TO_QK[sn];
  const units = attrs?.units ?? '';
  if (_UNITS_TO_QK[units]) return _UNITS_TO_QK[units];
  if ((sn === 'altitude' || sn === 'height') && units === 'm') return 'elevation_m';
  if (sn === 'depth' && units === 'm') return 'depth_m';
  return null;
}

// How much the viewport bbox must change (as a fraction of its extent) before
// we trigger a new tile-load phase.
const BBOX_CHANGE_THRESHOLD = 0.02;

// ── WebxtileColumn ─────────────────────────────────────────────────────────────
// Custom ColumnData that:
//   • serves GPU-texture data from the parent WebxtileDataset
//   • calls dataset._onRefresh(plot) each frame so the dataset can detect
//     viewport-bbox changes via plot.getAxisDomain() and trigger new tile loads
//   • invalidates its GPU texture cache when the dataset's _dataVersion changes
//     so that the next upload picks up the freshly loaded scatter data
class WebxtileColumn extends ArrayColumn {
  constructor(dataset, colName) {
    // ArrayColumn needs a non-empty array. Use a 1-element placeholder until
    // real data arrives; _ref is cleared in refresh() when the version changes.
    super(new Float32Array([0]), { domain: null, quantityKind: null });
    this._dataset       = dataset;
    this._colName       = colName;
    this._lastVersion   = -1;
  }

  // ── Dynamic metadata (changes as tiles load) ─────────────────────────────
  get length()       { return this._dataset._scatter?.count ?? 0; }
  get domain()       { return this._dataset.getDomain(this._colName) ?? null; }
  get quantityKind() { return this._dataset.getQuantityKind(this._colName) ?? null; }
  get array()        { return this._dataset._getRawArray(this._colName) ?? new Float32Array([0]); }
  get shape()        { return [Math.max(this.length, 1)]; }

  // ── GPU texture upload ───────────────────────────────────────────────────
  // Override ArrayColumn._upload() to use the dataset's live array and to
  // respect the regl texture size limit.
  _upload(regl) {
    if (this._ref) return this._ref;
    const arr = this.array;
    const n = arr.length;
    const nTexels = Math.ceil(Math.max(n, 1) / 4);
    const w = Math.min(nTexels, regl.limits.maxTextureSize);
    const h = Math.ceil(nTexels / w);
    const texData = new Float32Array(w * h * 4);
    texData.set(arr);
    const texture = regl.texture({ data: texData, shape: [w, h], type: 'float', format: 'rgba' });
    texture._dataLength = n;
    this._ref = { texture };
    return this._ref;
  }

  // ── refresh(plot) — called by gladly before every render ────────────────
  async refresh(plot) {
    this._dataset._plot = plot;  // stored so async tile arrivals can call scheduleRender()
    this._dataset._onRefresh(plot);

    if (this._dataset._dataVersion !== this._lastVersion) {
      this._lastVersion = this._dataset._dataVersion;
      // Destroy the old GPU texture; _upload() will re-create it with the new data.
      if (this._ref?.texture) {
        try { this._ref.texture.destroy(); } catch (_) {}
      }
      this._ref = null;
      return true;
    }
    return false;
  }
}

// ── WebxtileDataset ────────────────────────────────────────────────────────────
export class WebxtileDataset extends Dataset {
  constructor(metadata) {
    super(metadata);
    this._scatter       = null;
    this._spatialDims   = null;
    this._crs           = null;
    this._zCrs          = null;
    this._varMeta       = null;
    this._gridShape     = null;
    this._domainCache   = null;
    this._loader        = null;
    this._colCache      = {};     // { colName: WebxtileColumn } — reuse across renders
    this._dataVersion   = 0;
    this._loadGeneration = 0;
    this._loadStarted   = false;
    this._initialLoadPromise = null;
    this._currentBBox   = null;
    this._lastRefreshMs = 0;
    this._plot          = null;   // set by WebxtileColumn.refresh(); used to call scheduleRender()
  }

  // ── Public Data interface (used by gladly via Data.wrap) ─────────────────

  columns() {
    if (!this._scatter) return [];
    return [
      ...Object.keys(this._scatter.coords),
      ...Object.keys(this._scatter.variables),
    ];
  }

  getData(col) {
    if (!this._colCache[col]) {
      this._colCache[col] = new WebxtileColumn(this, col);
    }
    return this._colCache[col];
  }

  getQuantityKind(col) {
    if (!this._spatialDims) return col;
    const [dim0, dim1, dim2] = this._spatialDims;
    if (this._crs) {
      const code = parseCrsCode(this._crs);
      if (code != null) {
        if (col === dim0) return crsToQkX(code);
        if (col === dim1) return crsToQkY(code);
      }
    }
    if (col === dim2) return 'elevation_m';
    return _cfAttrsToQuantityKind(this._varMeta?.[col]?.attrs) ?? _COL_TO_QK[col] ?? col;
  }

  getDomain(col) {
    if (!this._scatter) return undefined;
    if (!this._domainCache) this._domainCache = {};
    if (col in this._domainCache) return this._domainCache[col];
    const arr = this._getRawArray(col);
    if (!arr || arr.length === 0) { this._domainCache[col] = undefined; return undefined; }
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
    }
    this._domainCache[col] = Number.isFinite(min) ? [min, max] : undefined;
    return this._domainCache[col];
  }

  _getRawArray(col) {
    if (!this._scatter) return undefined;
    return this._scatter.coords[col] ?? this._scatter.variables[col];
  }

  // ── fetchData — entry point called by ProcessContext ─────────────────────
  // Returns a WebxtileDataWrapper (implements columns/getData for gladly).
  cancel() {
    this._loadGeneration++;  // interrupts any in-flight _loadForBBox / _loadAndUpdate chain
  }

  async fetchData(partPath = "all") {
    if (!this._loadStarted) {
      this._loadStarted = true;
      this._initialLoadPromise = this._startLoading();
    }
    if (!this._scatter) {
      await this._initialLoadPromise;
    }
    return this;
  }

  async _startLoading() {
    try {
      const partMetadata = this._getPartMetadata('all');
      const url = partMetadata?.files?.[this.mimeType];
      if (!url) throw new Error('No webxtile URL found in dataset metadata');
      this._loader = new WebxtileLoader(url, { dbName: `webxtile-${this.id}` });
      await this._loader.open();
    } catch (err) {
      console.error('WebxtileDataset: failed to open loader', err);
      return;
    }

    // Phase 1: coarse overview so the user sees something immediately.
    // (If a bbox is already stored from a previous refresh(), it will be used
    //  once _loadForBBox is called below. But on first load there is none.)
    const gen = ++this._loadGeneration;
    await this._loadAndUpdate(null, { level: 0 }, gen);

    // Phase 2 runs in background and is interrupted on bbox change.
    this._loadForBBox(this._currentBBox, gen);
  }

  // ── _onRefresh — called by WebxtileColumn.refresh(plot) every render ─────
  // Uses gladly's standard plot.getAxisDomain() to read the current viewport
  // bbox and trigger a new priority load if it has changed significantly.
  _onRefresh(plot) {
    const now = performance.now();
    if (now - this._lastRefreshMs < 100) return;  // 100 ms throttle
    this._lastRefreshMs = now;

    if (!this._spatialDims || this._spatialDims.length < 2) return;

    const xQK = this.getQuantityKind(this._spatialDims[0]);
    const yQK = this.getQuantityKind(this._spatialDims[1]);
    const xDomain = plot.getAxisDomain(xQK);
    const yDomain = plot.getAxisDomain(yQK);
    if (!xDomain || !yDomain) return;

    const newBBox = [xDomain[0], yDomain[0], xDomain[1], yDomain[1]];
    if (this._bboxSimilar(newBBox, this._currentBBox)) return;

    this._currentBBox = newBBox;
    // Interrupt any in-flight background load and start a new priority sequence.
    const gen = ++this._loadGeneration;
    this._loadForBBox(newBBox, gen);
  }

  _bboxSimilar(a, b) {
    if (!a || !b) return !a && !b;
    const dx = Math.abs(a[2] - a[0]);
    const dy = Math.abs(a[3] - a[1]);
    if (dx === 0 || dy === 0) return false;
    return (
      Math.abs(a[0] - b[0]) / dx < BBOX_CHANGE_THRESHOLD &&
      Math.abs(a[2] - b[2]) / dx < BBOX_CHANGE_THRESHOLD &&
      Math.abs(a[1] - b[1]) / dy < BBOX_CHANGE_THRESHOLD &&
      Math.abs(a[3] - b[3]) / dy < BBOX_CHANGE_THRESHOLD
    );
  }

  // ── Progressive load sequence ─────────────────────────────────────────────
  // 1. If bbox is given: load tiles relevant to that bbox at full resolution.
  // 2. Then load all remaining leaf tiles (full dataset).
  // Aborts each step if _loadGeneration changes (new bbox arrived).
  async _loadForBBox(bbox, generation) {
    if (!this._loader) return;

    if (bbox) {
      // Priority: full-resolution tiles for the current viewport.
      await this._loadAndUpdate(bbox, { level: null }, generation);
      if (this._loadGeneration !== generation) return;
    }

    // Fill in the complete dataset at full leaf resolution.
    await this._loadAndUpdate(null, { level: null }, generation);
  }

  async _loadAndUpdate(bbox, options, generation) {
    if (!this._loader) return;
    try {
      const result = await this._loader.loadBBox(bbox, options);
      if (this._loadGeneration !== generation) return;  // interrupted — discard
      this._applyResult(result);
    } catch (err) {
      console.error('WebxtileDataset: tile load failed', bbox, options, err);
    }
  }

  _applyResult(result) {
    this._crs         = result.crs;
    this._zCrs        = result.zCrs;
    this._spatialDims = result.spatialDims;
    this._varMeta     = result.varMeta;
    this._gridShape   = result.spatialDims.map(d => result.meta.dim_sizes?.[d] ?? 1);
    this._domainCache = {};

    if (this._crs) {
      const code = parseCrsCode(this._crs);
      if (code != null) {
        registerAxisQuantityKind(`epsg_${code}_x`, { label: `EPSG:${code} X`, scale: 'linear' });
        registerAxisQuantityKind(`epsg_${code}_y`, { label: `EPSG:${code} Y`, scale: 'linear' });
      }
    }

    this._scatter = result.toScatter();
    this._dataVersion++;

    // Wake up gladly's render loop; WebxtileColumn.refresh() returning true
    // will invalidate the GPU texture and re-read length from the updated scatter.
    this._plot?.scheduleRender();
  }
}
