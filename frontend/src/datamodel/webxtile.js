import { WebxtileLoader, WebxtileResult } from 'webxtile';
import { ArrayColumn } from 'gladly-plot';
import { Dataset, acquireFetchSlot, releaseFetchSlot } from './dataset';
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

// How much the viewport bbox must change before triggering a new tile-load phase.
const BBOX_CHANGE_THRESHOLD = 0.02;

// Viewport intersection test used by _selectDisplayTiles.
// bounds: always 6 elements [x0, y0, z0, x1, y1, z1]
// bbox:   null (no filter) or [xmin, ymin, xmax, ymax] (viewport is always 2-D)
function _tileIntersectsViewport(bounds, bbox) {
  if (bbox === null) return true;
  if (bbox[2] < bounds[0]) return false; // vp_xmax < tile_xmin
  if (bbox[0] > bounds[3]) return false; // vp_xmin > tile_xmax
  if (bbox[3] < bounds[1]) return false; // vp_ymax < tile_ymin
  if (bbox[1] > bounds[4]) return false; // vp_ymin > tile_ymax
  return true;
}

// ── WebxtileColumn ─────────────────────────────────────────────────────────────
// Custom ColumnData that:
//   • serves GPU-texture data from the parent WebxtileDataset
//   • calls dataset._onRefresh(plot) each frame so the dataset can detect
//     viewport-bbox changes via plot.getAxisDomain() and trigger new tile loads
//   • invalidates its GPU texture cache when the dataset's _dataVersion changes
//     so that the next upload picks up the freshly rebuilt scatter data
class WebxtileColumn extends ArrayColumn {
  constructor(dataset, colName) {
    super(new Float32Array([0]), { domain: null, quantityKind: null });
    this._dataset       = dataset;
    this._colName       = colName;
    this._lastVersion   = -1;
  }

  get length()       { return this._dataset._scatter?.count ?? 0; }
  get domain()       { return this._dataset.getDomain(this._colName) ?? null; }
  get quantityKind() { return this._dataset.getQuantityKind(this._colName) ?? null; }
  get array()        { return this._dataset._getRawArray(this._colName) ?? new Float32Array([0]); }
  get shape()        { return [Math.max(this.length, 1)]; }

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

  async refresh(plot) {
    this._dataset._plot = plot;
    this._dataset._onRefresh(plot);

    if (this._dataset._dataVersion !== this._lastVersion) {
      this._lastVersion = this._dataset._dataVersion;
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
    // Persistent tile registry — every tile fetched from the network or IDB
    // is stored here, keyed by its filename (relative to the base URL).
    this._tileCache      = new Map();
    this._rootFilename   = null;   // set from result.meta on first _applyResult
    this._tileMeta       = null;   // full metadata object (for WebxtileResult)
    this._scatter        = null;
    this._spatialDims    = null;
    this._crs            = null;
    this._zCrs           = null;
    this._varMeta        = null;
    this._gridShape      = null;
    this._domainCache    = null;
    this._loader         = null;
    this._colCache       = {};
    this._dataVersion    = 0;
    this._loadGeneration = 0;
    this._loadStarted    = false;
    this._initialLoadPromise = null;
    this._currentBBox    = null;
    this._lastRefreshMs  = 0;
    this._plot           = null;
  }

  // ── Public Data interface ────────────────────────────────────────────────────

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

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  cancel() {
    this._loadGeneration++;
    this._loadStarted = false;
    this._initialLoadPromise = null;
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
      this._loader = new WebxtileLoader(url, {
        dbName:  `webxtile-${this.id}`,
        acquire: acquireFetchSlot,
        release: releaseFetchSlot,
      });
      await this._loader.open();
    } catch (err) {
      console.error('WebxtileDataset: failed to open loader', err);
      return;
    }

    // Phase 1: load root tile so we have columns and a coarse overview immediately.
    const gen = ++this._loadGeneration;
    await this._loadAndUpdate(null, { level: 0 }, gen);

    // Phase 2: load detail for whatever viewport is already known.
    this._loadForBBox(this._currentBBox, gen);
  }

  // ── Viewport-change detection ────────────────────────────────────────────────

  _onRefresh(plot) {
    const now = performance.now();
    if (now - this._lastRefreshMs < 100) return;
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

    // Immediately re-select display tiles from the cache for the new viewport —
    // no network round-trip, same as a slippy map swapping in cached tiles.
    this._updateDisplayScatter();

    // Background: fetch tiles at the appropriate LOD for this viewport.
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

  // ── Tile loading ─────────────────────────────────────────────────────────────

  async _loadForBBox(bbox, generation) {
    if (!this._loader || !bbox) return;
    // Load tiles at the LOD appropriate for the current zoom level.
    const targetLevel = this._computeTargetLevel();
    await this._loadAndUpdate(bbox, { level: targetLevel }, generation);
  }

  async _loadAndUpdate(bbox, options, generation) {
    if (!this._loader) return;
    try {
      const result = await this._loader.loadBBox(bbox, options);
      if (this._loadGeneration !== generation) return;
      this._applyResult(result);
    } catch (err) {
      console.error('WebxtileDataset: tile load failed', bbox, options, err);
    }
  }

  // Merge newly-fetched tiles into the persistent cache, then reselect the
  // display set.  Metadata (crs, dims, …) is taken from the first result.
  _applyResult(result) {
    this._crs         = result.crs;
    this._zCrs        = result.zCrs;
    this._spatialDims = result.spatialDims;
    this._varMeta     = result.varMeta;
    this._tileMeta    = result.meta;
    this._gridShape   = result.spatialDims.map(d => result.meta.dim_sizes?.[d] ?? 1);

    if (!this._rootFilename) {
      this._rootFilename = result.meta.root_tile ?? 'root.msgpack';
    }

    if (this._crs) {
      const code = parseCrsCode(this._crs);
      if (code != null) {
        registerAxisQuantityKind(`epsg_${code}_x`, { label: `EPSG:${code} X`, scale: 'linear' });
        registerAxisQuantityKind(`epsg_${code}_y`, { label: `EPSG:${code} Y`, scale: 'linear' });
      }
    }

    for (const tile of result.tiles) {
      if (tile._filename) this._tileCache.set(tile._filename, tile);
    }

    this._updateDisplayScatter();
  }

  // ── Display selection ────────────────────────────────────────────────────────

  // Rebuild _scatter from the tiles that are appropriate for the current
  // viewport and zoom level, using only what is already in _tileCache.
  _updateDisplayScatter() {
    if (!this._tileMeta || !this._rootFilename) return;
    const tiles = this._selectDisplayTiles();
    this._scatter     = new WebxtileResult(this._tileMeta, tiles).toScatter();
    this._domainCache = {};
    this._dataVersion++;
    this._plot?.scheduleRender();
  }

  // BFS over the cached tile tree.  For each spatial region:
  //   - if out of viewport: skip
  //   - if at or beyond target LOD, or a leaf: show this tile
  //   - if all children are cached: recurse for finer detail
  //   - if any child is missing: show this coarser tile as fallback
  // This mirrors exactly how a slippy map layer chooses tiles to paint.
  _selectDisplayTiles() {
    if (!this._rootFilename || !this._tileCache.has(this._rootFilename)) return [];
    const bbox        = this._currentBBox;
    const targetLevel = this._computeTargetLevel();
    const selected    = [];
    const queue       = [this._rootFilename];

    while (queue.length > 0) {
      const filename = queue.shift();
      const tile = this._tileCache.get(filename);
      if (!tile) continue;

      if (!_tileIntersectsViewport(tile.bounds, bbox)) continue;

      const isLeaf    = tile.is_leaf ?? (tile.children == null);
      const tileLevel = tile.level ?? 0;

      if (isLeaf || tileLevel >= targetLevel) {
        selected.push(tile);
        continue;
      }

      const children = tile.children ?? [];
      if (children.length > 0 && children.every(c => this._tileCache.has(c))) {
        queue.push(...children);  // all children cached: recurse for finer detail
      } else {
        selected.push(tile);      // some children missing: use coarser tile as fallback
      }
    }

    return selected;
  }

  // Estimate the target octree depth from the ratio of viewport size to root
  // tile size.  Each halving of the viewport corresponds to one extra level.
  _computeTargetLevel() {
    if (!this._currentBBox || !this._rootFilename) return 0;
    const root = this._tileCache.get(this._rootFilename);
    if (!root) return 0;

    const b     = root.bounds; // [x0, y0, z0, x1, y1, z1]
    const rootW = Math.abs(b[3] - b[0]);
    const rootH = Math.abs(b[4] - b[1]);
    if (rootW === 0 || rootH === 0) return 0;

    const [vx0, vy0, vx1, vy1] = this._currentBBox;
    const fraction = Math.min(
      Math.abs(vx1 - vx0) / rootW,
      Math.abs(vy1 - vy0) / rootH,
    );
    if (fraction <= 0) return 10;

    return Math.min(10, Math.ceil(Math.log2(1 / fraction)));
  }
}
