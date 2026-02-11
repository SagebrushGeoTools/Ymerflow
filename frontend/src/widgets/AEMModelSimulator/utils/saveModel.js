import { XYZ } from '../../../datamodel/libaarhusxyz';
import { calculateLayerDepths } from './geometry';
import { packBinary } from 'msgpack-numpy-js';

/**
 * Convert flightline models to XYZ msgpack format and download
 *
 * @param {Array} flightlines - Array of flightline model objects
 * @param {string} filename - Output filename
 * @param {Object} modelInfo - Optional model metadata to preserve
 */
export function saveModelToFile(flightlines, filename = 'model.xyz', modelInfo = null) {
  try {
    // Create XYZ object
    const xyzData = convertFlightlinesToXYZ(flightlines, modelInfo);

    // Convert to msgpack binary
    const xyz = new XYZ(createMsgpackBuffer(xyzData));
    const binary = xyz.dump();

    // Download file
    downloadBinary(binary, filename);

    return true;
  } catch (error) {
    console.error('Failed to save model:', error);
    throw error;
  }
}

/**
 * Convert flightline model objects to XYZ data structure (exported for SaveModelDialog)
 * @param {Array} flightlines - Array of flightline model objects
 * @param {Object} modelInfo - Model metadata (projection, etc.) to preserve
 * @returns {Object} XYZ data structure
 */
export function convertFlightlinesToXYZ(flightlines, modelInfo) {
  if (!flightlines || flightlines.length === 0) {
    throw new Error('No flightlines to save');
  }

  // For single flightline, create simple structure
  if (flightlines.length === 1) {
    return convertSingleFlightlineToXYZ(flightlines[0], modelInfo);
  }

  // For multiple flightlines, merge them
  return mergeFlightlinesToXYZ(flightlines, modelInfo);
}

/**
 * Convert single flightline to XYZ structure
 */
function convertSingleFlightlineToXYZ(flightline, modelInfo) {
  const nSoundings = flightline.xdist.length;
  const nLayers = flightline.resistivity.length;

  // Calculate layer depths
  const layerDepths = calculateLayerDepths(flightline.config.layerThicknesses);

  // Calculate TxAltitude (altitude above ground) from flight elevation and topo
  // TxAltitude = flightElevation - topoElevation
  const txAltitude = new Float64Array(flightline.xdist.length);
  for (let i = 0; i < flightline.xdist.length; i++) {
    txAltitude[i] = flightline.flightElevation[i] - flightline.topo[i];
  }

  // Build flightlines dict (per-sounding data)
  const flightlinesData = {
    xdist: new Float64Array(flightline.xdist),
    utmx: new Float64Array(flightline.utmx),
    utmy: new Float64Array(flightline.utmy),
    topo: new Float64Array(flightline.topo),
    TxAltitude: txAltitude  // ALTITUDE above ground, not elevation!
  };

  // Build layer_data dict (per-layer-per-sounding data)
  const layerData = {
    resistivity: {},
    dep_top: {},
    dep_bot: {}
  };

  for (let layerIdx = 0; layerIdx < nLayers; layerIdx++) {
    // Resistivity values
    layerData.resistivity[layerIdx] = new Float64Array(flightline.resistivity[layerIdx]);

    // Depth top and bottom for this layer
    const depTop = new Float64Array(nSoundings);
    const depBot = new Float64Array(nSoundings);

    for (let i = 0; i < nSoundings; i++) {
      depTop[i] = layerDepths[layerIdx];
      depBot[i] = layerDepths[layerIdx + 1];
    }

    layerData.dep_top[layerIdx] = depTop;
    layerData.dep_bot[layerIdx] = depBot;
  }

  // Merge preserved modelInfo with current metadata
  const baseModelInfo = modelInfo || {};
  const finalModelInfo = {
    ...baseModelInfo,
    created_by: 'AEM Model Simulator',
    created_at: new Date().toISOString(),
    flightline_name: flightline.name,
    // Preserve projection if it exists, otherwise use from flightline.model_info
    projection: baseModelInfo.projection || flightline.model_info?.projection,
    coordinate_system: baseModelInfo.coordinate_system || flightline.model_info?.coordinate_system
  };

  return {
    model_info: finalModelInfo,
    flightlines: flightlinesData,
    layer_data: layerData,
    system: {} // Empty system/GEX data for now
  };
}

/**
 * Merge multiple flightlines into single XYZ structure
 * Each flightline becomes a separate "part"
 */
function mergeFlightlinesToXYZ(flightlines, modelInfo) {
  // Calculate total number of soundings
  let totalSoundings = 0;
  for (const fl of flightlines) {
    totalSoundings += fl.xdist.length;
  }

  // Determine number of layers (use first flightline)
  const nLayers = flightlines[0].resistivity.length;

  // Pre-allocate arrays
  const xdist = new Float64Array(totalSoundings);
  const utmx = new Float64Array(totalSoundings);
  const utmy = new Float64Array(totalSoundings);
  const topo = new Float64Array(totalSoundings);
  const txAltitudeAboveGround = new Float64Array(totalSoundings);
  const part = new Array(totalSoundings);

  const resistivity = {};
  const dep_top = {};
  const dep_bot = {};

  for (let layerIdx = 0; layerIdx < nLayers; layerIdx++) {
    resistivity[layerIdx] = new Float64Array(totalSoundings);
    dep_top[layerIdx] = new Float64Array(totalSoundings);
    dep_bot[layerIdx] = new Float64Array(totalSoundings);
  }

  // Fill arrays by concatenating flightlines
  let offset = 0;
  for (const fl of flightlines) {
    const nSoundings = fl.xdist.length;
    const layerDepths = calculateLayerDepths(fl.config.layerThicknesses);

    // Copy per-sounding data
    xdist.set(fl.xdist, offset);
    utmx.set(fl.utmx, offset);
    utmy.set(fl.utmy, offset);
    topo.set(fl.topo, offset);

    // Calculate TxAltitude (altitude above ground) = flightElevation - topo
    for (let i = 0; i < nSoundings; i++) {
      txAltitudeAboveGround[offset + i] = fl.flightElevation[i] - fl.topo[i];
    }

    // Set part names
    for (let i = 0; i < nSoundings; i++) {
      part[offset + i] = fl.name;
    }

    // Copy layer data
    for (let layerIdx = 0; layerIdx < nLayers; layerIdx++) {
      resistivity[layerIdx].set(fl.resistivity[layerIdx], offset);

      // Fill depths
      for (let i = 0; i < nSoundings; i++) {
        dep_top[layerIdx][offset + i] = layerDepths[layerIdx];
        dep_bot[layerIdx][offset + i] = layerDepths[layerIdx + 1];
      }
    }

    offset += nSoundings;
  }

  // Merge preserved modelInfo with current metadata
  const baseModelInfo = modelInfo || {};
  const finalModelInfo = {
    ...baseModelInfo,
    created_by: 'AEM Model Simulator',
    created_at: new Date().toISOString(),
    num_flightlines: flightlines.length,
    flightline_names: flightlines.map(fl => fl.name).join(', '),
    // Preserve projection if it exists, otherwise use from first flightline
    projection: baseModelInfo.projection || flightlines[0].model_info?.projection,
    coordinate_system: baseModelInfo.coordinate_system || flightlines[0].model_info?.coordinate_system
  };

  return {
    model_info: finalModelInfo,
    flightlines: {
      xdist: xdist,
      utmx: utmx,
      utmy: utmy,
      topo: topo,
      TxAltitude: txAltitudeAboveGround,  // ALTITUDE above ground, not elevation!
      part: part
    },
    layer_data: {
      resistivity: resistivity,
      dep_top: dep_top,
      dep_bot: dep_bot
    },
    system: {}
  };
}

/**
 * Create a msgpack buffer from XYZ data structure
 * This is a minimal implementation that creates a valid buffer for XYZ constructor
 */
function createMsgpackBuffer(xyzData) {
  // Use packBinary which properly encodes numpy arrays (typed arrays)
  const packed = packBinary(xyzData);
  return packed;
}

/**
 * Download binary data as file
 */
function downloadBinary(binary, filename) {
  const blob = new Blob([binary], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up
  URL.revokeObjectURL(url);
}
