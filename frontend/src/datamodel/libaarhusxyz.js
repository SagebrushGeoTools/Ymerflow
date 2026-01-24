import msgpack from 'msgpack-lite';
import { unpackNumpy, packNumpy, unpackBinary, packBinary } from 'msgpack-numpy-js';

/**
 * JavaScript implementation of libaarhusxyz.XYZ class
 *
 * This class mirrors the Python libaarhusxyz.XYZ API but only supports
 * reading/writing the msgpack format (not text XYZ formats).
 *
 * Data structure:
 * {
 *   model_info: {key: value},        // Metadata
 *   flightlines: {                   // Main data (one row per sounding)
 *     column_name: TypedArray,
 *     ...
 *   },
 *   layer_data: {                    // Channel data
 *     channel_name: {
 *       column_name: TypedArray,
 *       ...
 *     },
 *     ...
 *   }
 * }
 */
export class XYZ {
  /**
   * Create XYZ object from msgpack binary data
   *
   * @param {ArrayBuffer|Uint8Array} msgpackBinary - Binary msgpack data
   */
  constructor(msgpackBinary) {
    // Use high-level API that handles both msgpack decoding and numpy unpacking
    this._data = unpackBinary(new Uint8Array(msgpackBinary));

    console.log("XYZ _data after unpackBinary:", this._data);
    console.log("_data.flightlines.lat:", this._data.flightlines?.lat, "type:", this._data.flightlines?.lat?.constructor?.name);

    // Validate structure
    if (!this._data.model_info) {
      this._data.model_info = {};
    }
    if (!this._data.flightlines) {
      throw new Error("Invalid XYZ data: missing flightlines");
    }
    if (!this._data.layer_data) {
      this._data.layer_data = {};
    }
  }

  /**
   * Create XYZ object from URL
   *
   * @param {string} url - URL to fetch msgpack data from
   * @returns {Promise<XYZ>} XYZ object
   */
  static async fromURL(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch XYZ data: ${response.statusText}`);
    }
    const binary = await response.arrayBuffer();
    return new XYZ(binary);
  }

  /**
   * Get metadata dictionary
   *
   * @returns {Object} Metadata
   */
  get info() {
    return this._data.model_info;
  }

  /**
   * Set metadata dictionary
   */
  set info(value) {
    this._data.model_info = value;
  }

  /**
   * Get flightlines data (main DataFrame as dict of typed arrays)
   *
   * @returns {Object} Flightlines data {column_name: TypedArray, ...}
   */
  get flightlines() {
    return this._data.flightlines;
  }

  /**
   * Set flightlines data
   */
  set flightlines(value) {
    this._data.flightlines = value;
  }

  /**
   * Get layer data (dict of channels, each channel is dict of typed arrays)
   *
   * @returns {Object} Layer data {channel_name: {column_name: TypedArray, ...}, ...}
   */
  get layer_data() {
    return this._data.layer_data;
  }

  /**
   * Set layer data
   */
  set layer_data(value) {
    this._data.layer_data = value;
  }

  /**
   * Export to msgpack binary
   *
   * @returns {Uint8Array} Binary msgpack data
   */
  dump() {
    // Use high-level API that handles both numpy packing and msgpack encoding
    return packBinary(this._data);
  }

  /**
   * Get string representation
   *
   * @returns {string} String representation
   */
  toString() {
    const parts = [];

    // Info
    parts.push("XYZ Object");
    parts.push("==========");

    if (Object.keys(this.info).length > 0) {
      parts.push("\nMetadata:");
      for (const [key, value] of Object.entries(this.info)) {
        parts.push(`  ${key}: ${value}`);
      }
    }

    // Flightlines
    parts.push("\nFlightlines:");
    const flColumns = Object.keys(this.flightlines);
    const flLength = flColumns.length > 0 ? this.flightlines[flColumns[0]].length : 0;
    parts.push(`  Columns: ${flColumns.join(', ')}`);
    parts.push(`  Rows: ${flLength}`);

    // Layer data
    parts.push("\nLayer Data:");
    const channels = Object.keys(this.layer_data);
    if (channels.length === 0) {
      parts.push("  (none)");
    } else {
      for (const channel of channels) {
        const channelData = this.layer_data[channel];
        const chColumns = Object.keys(channelData);
        const chLength = chColumns.length > 0 ? channelData[chColumns[0]].length : 0;
        parts.push(`  ${channel}:`);
        parts.push(`    Columns: ${chColumns.join(', ')}`);
        parts.push(`    Rows: ${chLength}`);
      }
    }

    return parts.join('\n');
  }
}

export default XYZ;
