import { WebxtileLoader } from 'webxtile';
import { ArrayColumn } from 'gladly-plot';
import { Dataset } from './dataset';
import { parseCrsCode, crsToQkX, crsToQkY, registerAxisQuantityKind } from 'gladly-plot';

// Map CF standard_name / units to gladly quantity kind strings.
function _cfAttrsToQuantityKind(attrs) {
  const sn    = attrs?.standard_name ?? '';
  const units = attrs?.units ?? '';
  if (sn === 'electrical_resistivity' || units === 'ohm m') return 'log_resistivity';
  if (sn === 'depth_of_investigation')                       return 'doi_m';
  if ((sn === 'altitude' || sn === 'height') && units === 'm') return 'elevation_m';
  if (sn === 'depth' && units === 'm')                       return 'depth_m';
  return null;
}

// Fallback: well-known AEM column names → quantity kind (used when CF attrs are absent).
const _COLUMN_NAME_QK = {
  resistivity:  'log_resistivity',
  doi_layer:    'doi_m',
  conductivity: 'conductivity_sm',
  z_top:        'elevation_m',
  z_bottom:     'elevation_m',
};

export class WebxtileDataset extends Dataset {
  constructor(metadata) {
    super(metadata);
    this._scatter = null;
    this._spatialDims = null;
    this._crs = null;
    this._zCrs = null;
    this._varMeta = null;
    this._gridShape = null;
  }

  async fetchData(partPath = "all") {
    if (this._scatter) return this._scatter;

    const partMetadata = this._getPartMetadata('all');
    const url = partMetadata?.files?.[this.mimeType];
    if (!url) {
      console.error('No webxtile URL found in dataset metadata', this.metadata);
      return null;
    }

    const loader = new WebxtileLoader(url, { dbName: `webxtile-${this.id}` });
    await loader.open();

    const result = await loader.loadBBox(null);
    this._crs = result.crs;
    this._zCrs = result.zCrs;
    this._spatialDims = result.spatialDims;
    this._varMeta = result.varMeta;

    // Register CRS quantity kinds so gladly axes are labelled correctly
    if (this._crs) {
      const code = parseCrsCode(this._crs);
      if (code != null) {
        registerAxisQuantityKind(`epsg_${code}_x`, { label: `EPSG:${code} X`, scale: 'linear' });
        registerAxisQuantityKind(`epsg_${code}_y`, { label: `EPSG:${code} Y`, scale: 'linear' });
      }
    }

    this._scatter = result.toScatter();
    this._gridShape = result.spatialDims.map(d => result.meta.dim_sizes?.[d] ?? 1);
    return this._scatter;
  }

  // ── Gladly Data interface ─────────────────────────────────────────────────

  columns() {
    if (!this._scatter) return [];
    return [
      ...Object.keys(this._scatter.coords),
      ...Object.keys(this._scatter.variables),
    ];
  }

  _getRawArray(col) {
    if (!this._scatter) return undefined;
    return this._scatter.coords[col] ?? this._scatter.variables[col];
  }

  getData(col) {
    const arr = this._getRawArray(col);
    if (!arr) return undefined;
    const totalSize = this._gridShape ? this._gridShape.reduce((a, b) => a * b, 1) : null;
    const col_obj = new ArrayColumn(arr, {
      shape: totalSize ? [totalSize] : null,
      domain: this.getDomain(col) ?? null,
      quantityKind: this.getQuantityKind(col) ?? null,
    });
    const dimIdx = this._spatialDims ? this._spatialDims.indexOf(col) : -1;
    if (dimIdx >= 0) {
      const n = this._gridShape[dimIdx];
      const domain = this.getDomain(col);
      col_obj.delta = (domain && n > 1) ? (domain[1] - domain[0]) / (n - 1) : (domain?.[1] - domain?.[0] || 1);
    }
    return col_obj;
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
    const qk = _cfAttrsToQuantityKind(this._varMeta?.[col]?.attrs) ?? _COLUMN_NAME_QK[col];
    return qk ?? col;
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
}
