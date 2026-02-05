import { unpackBinary, packBinary } from 'msgpack-numpy-js';

/**
 * JavaScript implementation of AirMagTools.MagData class.
 *
 * Mirrors the Python MagData API but only supports the msgpack format.
 *
 * Wire format (produced by MagData.save() with a .msgpack path):
 * {
 *   data: {                // Column-oriented table (line & fidcount included as columns)
 *     line:      TypedArray,
 *     fidcount:  TypedArray,
 *     easting:   TypedArray,
 *     northing:  TypedArray,
 *     magcom:    TypedArray,
 *     ...
 *   },
 *   meta: { ... }          // Arbitrary metadata (crs, filename, sample_frequency, …)
 * }
 */
export class MagData {
  /**
   * Create a MagData object from msgpack binary data.
   *
   * @param {ArrayBuffer|Uint8Array} msgpackBinary - Binary msgpack payload
   */
  constructor(msgpackBinary) {
    this._raw = unpackBinary(new Uint8Array(msgpackBinary));

    if (!this._raw.data) {
      throw new Error('Invalid MagData: missing data');
    }
    if (!this._raw.meta) {
      this._raw.meta = {};
    }
  }

  /**
   * Create a MagData object by fetching from a URL.
   *
   * @param {string} url - URL that returns msgpack binary
   * @returns {Promise<MagData>}
   */
  static async fromURL(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch MagData: ${response.statusText}`);
    }
    return new MagData(await response.arrayBuffer());
  }

  /** Column-oriented data table {columnName: TypedArray, …} */
  get data() {
    return this._raw.data;
  }
  set data(value) {
    this._raw.data = value;
  }

  /** Metadata dictionary */
  get meta() {
    return this._raw.meta;
  }
  set meta(value) {
    this._raw.meta = value;
  }

  /**
   * Number of rows (soundings) in the dataset.
   */
  get length() {
    const firstCol = Object.keys(this.data)[0];
    return firstCol ? this.data[firstCol].length : 0;
  }

  /**
   * Unique line identifiers, preserving encounter order.
   *
   * @returns {Array} Sorted unique values from the 'line' column
   */
  getLines() {
    const lineCol = this.data.line;
    if (!lineCol) return [];
    return [...new Set(lineCol)].sort((a, b) => a - b);
  }

  /**
   * Return a subset of the data for a single line.
   *
   * @param {number|string} lineId - Line identifier to filter on
   * @returns {Object} Column-oriented subset {columnName: TypedArray, …}
   */
  getLine(lineId) {
    const lineCol = this.data.line;
    if (!lineCol) return {};

    // Build mask of matching indices
    const indices = [];
    for (let i = 0; i < lineCol.length; i++) {
      if (lineCol[i] === lineId) indices.push(i);
    }

    const subset = {};
    for (const [col, arr] of Object.entries(this.data)) {
      subset[col] = indices.map(i => arr[i]);
    }
    return subset;
  }

  /**
   * Serialise back to msgpack binary.
   *
   * @returns {Uint8Array}
   */
  dump() {
    return packBinary(this._raw);
  }

  /**
   * Human-readable summary (mirrors Python __repr__ intent).
   *
   * @returns {string}
   */
  toString() {
    const columns = Object.keys(this.data);
    const lines = this.getLines();

    const parts = [
      'MagData',
      '=======',
    ];

    if (Object.keys(this.meta).length > 0) {
      parts.push('\nMetadata:');
      for (const [key, value] of Object.entries(this.meta)) {
        parts.push(`  ${key}: ${value}`);
      }
    }

    parts.push(`\nRows: ${this.length}`);
    parts.push(`Columns: ${columns.join(', ')}`);
    parts.push(`Lines: ${lines.join(', ')}`);

    return parts.join('\n');
  }
}

export default MagData;
