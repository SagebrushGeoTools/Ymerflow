import { WebxtileLoader } from 'webxtile';
import { Dataset } from './dataset';
import { parseCrsCode, crsToQkX, crsToQkY, registerAxisQuantityKind } from 'gladly-plot';

export class WebxtileDataset extends Dataset {
  constructor(metadata) {
    super(metadata);
    this._scatter = null;
    this._spatialDims = null;
    this._crs = null;
    this._zCrs = null;
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

    // Register CRS quantity kinds so gladly axes are labelled correctly
    if (this._crs) {
      const code = parseCrsCode(this._crs);
      if (code != null) {
        registerAxisQuantityKind(`epsg_${code}_x`, { label: `EPSG:${code} X`, scale: 'linear' });
        registerAxisQuantityKind(`epsg_${code}_y`, { label: `EPSG:${code} Y`, scale: 'linear' });
      }
    }

    this._scatter = result.toScatter();
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

  getData(col) {
    if (!this._scatter) return undefined;
    return this._scatter.coords[col] ?? this._scatter.variables[col];
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
    return col;
  }

  getDomain(col) {
    if (!this._scatter) return undefined;
    if (!this._domainCache) this._domainCache = {};
    if (col in this._domainCache) return this._domainCache[col];
    const arr = this.getData(col);
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
