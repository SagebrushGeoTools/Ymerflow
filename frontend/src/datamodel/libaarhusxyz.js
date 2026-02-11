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
   * Create XYZ object from msgpack binary data OR merge multiple XYZ objects
   *
   * @param {...(ArrayBuffer|Uint8Array|XYZ)} args - Binary msgpack data or XYZ objects to merge
   */
  constructor(...args) {
    // Check if merging multiple XYZ objects (Python-style)
    if (args.length > 0 && args[0] instanceof XYZ) {
      this._data = this._mergeXYZObjects(args);
    } else if (args.length === 1) {
      // Single binary argument - existing behavior
      const msgpackBinary = args[0];

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
    } else {
      throw new Error("Invalid XYZ constructor arguments");
    }
  }

  /**
   * Merge multiple XYZ objects into one (Python-style concatenation)
   * @private
   */
  _mergeXYZObjects(xyzArray) {
    // Collect ALL flightline column names from ALL XYZ objects
    const flightlineKeys = new Set();
    xyzArray.forEach(xyz => {
      Object.keys(xyz.flightlines).forEach(key => flightlineKeys.add(key));
    });

    // Collect all layer_data keys from ALL XYZ objects
    const layerDataKeys = new Set();
    xyzArray.forEach(xyz => {
      Object.keys(xyz.layer_data).forEach(key => layerDataKeys.add(key));
    });

    // Collect all layer indices across all XYZs and data keys
    const allLayerIndices = new Map(); // dataKey -> Set of layer indices
    for (const dataKey of layerDataKeys) {
      allLayerIndices.set(dataKey, new Set());
      for (const xyz of xyzArray) {
        if (xyz.layer_data[dataKey]) {
          for (const layerIdx of xyz.layer_data[dataKey].keys()) {
            allLayerIndices.get(dataKey).add(layerIdx);
          }
        }
      }
    }

    // Merge model_info carefully - preserve fields from first, add new fields from others
    const model_info = { ...xyzArray[0].info };
    for (let i = 1; i < xyzArray.length; i++) {
      const otherInfo = xyzArray[i].info;
      for (const [key, value] of Object.entries(otherInfo)) {
        // Don't override flightline-specific metadata
        if (key !== 'flightline_name' && !(key in model_info)) {
          model_info[key] = value;
        }
      }
    }

    // Calculate total length
    const totalLength = xyzArray.reduce((sum, xyz) => {
      const firstKey = Object.keys(xyz.flightlines)[0];
      return sum + (xyz.flightlines[firstKey]?.length || 0);
    }, 0);

    // Allocate merged arrays for ALL columns
    const mergedFlightlines = {};
    for (const key of flightlineKeys) {
      // Find first XYZ that has this column to determine array type
      const sampleXYZ = xyzArray.find(xyz => xyz.flightlines[key]);
      if (sampleXYZ) {
        const sample = sampleXYZ.flightlines[key];
        const ArrayType = sample.constructor;
        const mergedArray = new ArrayType(totalLength);

        // Fill with NaN if it's a float array
        if (ArrayType === Float32Array || ArrayType === Float64Array) {
          mergedArray.fill(NaN);
        }

        mergedFlightlines[key] = mergedArray;
      }
    }

    // Allocate merged layer_data for ALL layers across ALL XYZs
    const mergedLayerData = {};
    for (const dataKey of layerDataKeys) {
      mergedLayerData[dataKey] = new Map();

      for (const layerIdx of allLayerIndices.get(dataKey)) {
        // Find first XYZ that has this layer to determine array type
        const sampleXYZ = xyzArray.find(
          xyz => xyz.layer_data[dataKey]?.has(layerIdx)
        );

        if (sampleXYZ) {
          const sample = sampleXYZ.layer_data[dataKey].get(layerIdx);
          const ArrayType = sample.constructor;
          const mergedArray = new ArrayType(totalLength);

          // Fill with NaN if it's a float array
          if (ArrayType === Float32Array || ArrayType === Float64Array) {
            mergedArray.fill(NaN);
          }

          mergedLayerData[dataKey].set(layerIdx, mergedArray);
        }
      }
    }

    // Copy data from each XYZ
    let offset = 0;
    xyzArray.forEach((xyz, xyzIndex) => {
      const firstKey = Object.keys(xyz.flightlines)[0];
      const length = xyz.flightlines[firstKey]?.length || 0;

      // Copy flightline data (only for columns that exist in this XYZ)
      for (const key of flightlineKeys) {
        if (xyz.flightlines[key]) {
          mergedFlightlines[key].set(xyz.flightlines[key], offset);
        }
        // If column doesn't exist in this XYZ, it remains NaN (already filled)
      }

      // Update Line column to track flightline index
      if (mergedFlightlines.Line) {
        for (let i = 0; i < length; i++) {
          mergedFlightlines.Line[offset + i] = xyzIndex;
        }
      }

      // Copy layer data (only for layers that exist in this XYZ)
      for (const dataKey of layerDataKeys) {
        if (xyz.layer_data[dataKey]) {
          for (const [layerIdx, array] of xyz.layer_data[dataKey].entries()) {
            if (mergedLayerData[dataKey].has(layerIdx)) {
              mergedLayerData[dataKey].get(layerIdx).set(array, offset);
            }
          }
        }
        // If layer doesn't exist in this XYZ, it remains NaN (already filled)
      }

      offset += length;
    });

    // Add flightline mapping to model_info
    model_info.flightline_mapping = {};
    xyzArray.forEach((xyz, idx) => {
      const name = xyz.info.flightline_name || `Flightline ${idx + 1}`;
      model_info.flightline_mapping[idx] = name;
    });
    model_info.num_flightlines = xyzArray.length;

    return {
      model_info,
      flightlines: mergedFlightlines,
      layer_data: mergedLayerData,
      system: xyzArray[0]._data.system || {}
    };
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
   * Get system/GEX data (contains channel configurations and gate times)
   *
   * @returns {Object} System data with GEX information
   */
  get system() {
    return this._data.system;
  }

  /**
   * Set system data
   */
  set system(value) {
    this._data.system = value;
  }

  /**
   * Split merged XYZ into separate XYZ objects per flightline
   * @returns {Array<XYZ>} Array of XYZ objects, one per flightline
   */
  split() {
    if (!this.flightlines.Line) {
      // Single flightline, return as-is
      return [this];
    }

    // Find unique line numbers
    const lineNumbers = [...new Set(this.flightlines.Line)].sort((a, b) => a - b);

    return lineNumbers.map(lineNo => {
      // Find indices for this line
      const indices = [];
      for (let i = 0; i < this.flightlines.Line.length; i++) {
        if (this.flightlines.Line[i] === lineNo) {
          indices.push(i);
        }
      }

      const length = indices.length;

      // Extract flightline data
      const flightlineData = {};
      for (const [key, array] of Object.entries(this.flightlines)) {
        const ArrayType = array.constructor;
        const extracted = new ArrayType(length);
        for (let i = 0; i < length; i++) {
          extracted[i] = array[indices[i]];
        }
        flightlineData[key] = extracted;
      }

      // Set all Line values to 0 (single flightline)
      if (flightlineData.Line) {
        flightlineData.Line.fill(0);
      }

      // Extract layer data
      const layerData = {};
      for (const [dataKey, layerMap] of Object.entries(this.layer_data)) {
        layerData[dataKey] = new Map();
        for (const [layerIdx, array] of layerMap.entries()) {
          const ArrayType = array.constructor;
          const extracted = new ArrayType(length);
          for (let i = 0; i < length; i++) {
            extracted[i] = array[indices[i]];
          }
          layerData[dataKey].set(layerIdx, extracted);
        }
      }

      // Create model_info for this flightline
      const flightlineName = this.info.flightline_mapping?.[lineNo] || `Flightline ${lineNo + 1}`;
      const model_info = {
        ...this.info,
        flightline_name: flightlineName
      };
      delete model_info.flightline_mapping;
      delete model_info.num_flightlines;

      // Create new XYZ from extracted data
      const extractedData = {
        model_info,
        flightlines: flightlineData,
        layer_data: layerData,
        system: this.system || {}
      };

      return new XYZ(packBinary(extractedData));
    });
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
   * Get gate times for a specific channel
   *
   * @param {number} channel - Channel number (1, 2, etc.)
   * @returns {Array} Array of gate times with columns [center, start, end]
   */
  gate_times(channel = 1) {
    const gex = this.system;

    if (!gex) {
      throw new Error("No GEX/system data available");
    }

    const ch_key = `Channel${channel}`;

    if (!gex[ch_key]) {
      throw new Error(`Channel ${channel} not found in GEX data`);
    }

    const moment_name = gex[ch_key].TransmitterMoment || "";

    // Look for GateTime{moment_name} or GateTime in General section
    let gate_time_array;
    const gateTimeKey = `GateTime${moment_name}`;

    if (gex.General && gex.General[gateTimeKey]) {
      gate_time_array = gex.General[gateTimeKey];
    } else if (gex.General && gex.General.GateTime) {
      gate_time_array = gex.General.GateTime;
    } else {
      throw new Error(`Unable to find General.GateTime or General.${gateTimeKey} in GEX`);
    }

    const remove_gates_from = parseInt(gex[ch_key].RemoveGatesFrom || 0);
    const no_gates = parseInt(gex[ch_key].NoGates || gate_time_array.length);

    const gate_time_shift = gex[ch_key].GateTimeShift || 0.0;
    const mea_time_delay = gex[ch_key].MeaTimeDelay || 0.0;
    const offset = gate_time_shift + mea_time_delay;

    // Slice the array and add offsets
    const result = [];
    for (let i = remove_gates_from; i < remove_gates_from + no_gates; i++) {
      if (i < gate_time_array.length) {
        const row = gate_time_array[i];
        // Add offset to all columns (center, start, end)
        result.push(row.map(t => t + offset));
      }
    }

    return result;
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
