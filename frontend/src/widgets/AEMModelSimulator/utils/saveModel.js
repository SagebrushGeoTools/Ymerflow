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

  // Always use the merge logic to ensure proper line_id column
  // This ensures consistent structure even for single flightlines
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
  const line_no = new Int32Array(nSoundings);
  line_no.fill(0); // All soundings belong to line 0

  const flightlinesData = {
    xdist: new Float64Array(flightline.xdist),
    UTMX: new Float64Array(flightline.utmx),  // ALC standard name
    UTMY: new Float64Array(flightline.utmy),  // ALC standard name
    Topography: new Float64Array(flightline.topo),  // ALC standard name
    TxAltitude: txAltitude,  // ALC standard name (ALTITUDE above ground, not elevation!)
    Line: line_no  // ALC standard name for line identifier
  };

  // Build layer_data dict (per-layer-per-sounding data)
  // Use Maps with integer keys (objects always have string keys in JS)
  const resistivity = new Map();
  const dep_top = new Map();
  const dep_bot = new Map();

  for (let layerIdx = 0; layerIdx < nLayers; layerIdx++) {
    // Resistivity values
    resistivity.set(layerIdx, new Float64Array(flightline.resistivity[layerIdx]));

    // Depth top and bottom for this layer
    const depTop = new Float64Array(nSoundings);
    const depBot = new Float64Array(nSoundings);

    for (let i = 0; i < nSoundings; i++) {
      depTop[i] = layerDepths[layerIdx];
      depBot[i] = layerDepths[layerIdx + 1];
    }

    dep_top.set(layerIdx, depTop);
    dep_bot.set(layerIdx, depBot);
  }

  const layerData = {
    resistivity: resistivity,
    dep_top: dep_top,
    dep_bot: dep_bot
  };

  // Merge preserved modelInfo with current metadata
  const baseModelInfo = modelInfo || {};
  const finalModelInfo = {
    ...baseModelInfo,
    created_by: 'AEM Model Simulator',
    created_at: new Date().toISOString(),
    flightline_name: flightline.name,
    flightline_mapping: { 0: flightline.name }, // Map line_no -> name
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
  const line_no = new Int32Array(totalSoundings); // Use numeric IDs instead of string names

  // Use Maps with integer keys (objects always have string keys in JS)
  const resistivity = new Map();
  const dep_top = new Map();
  const dep_bot = new Map();

  for (let layerIdx = 0; layerIdx < nLayers; layerIdx++) {
    resistivity.set(layerIdx, new Float64Array(totalSoundings));
    dep_top.set(layerIdx, new Float64Array(totalSoundings));
    dep_bot.set(layerIdx, new Float64Array(totalSoundings));
  }

  // Fill arrays by concatenating flightlines
  let offset = 0;
  for (let flIdx = 0; flIdx < flightlines.length; flIdx++) {
    const fl = flightlines[flIdx];
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

    // Set line_no (numeric ID) for each sounding
    for (let i = 0; i < nSoundings; i++) {
      line_no[offset + i] = flIdx;
    }

    // Copy layer data
    for (let layerIdx = 0; layerIdx < nLayers; layerIdx++) {
      resistivity.get(layerIdx).set(fl.resistivity[layerIdx], offset);

      // Fill depths
      for (let i = 0; i < nSoundings; i++) {
        dep_top.get(layerIdx)[offset + i] = layerDepths[layerIdx];
        dep_bot.get(layerIdx)[offset + i] = layerDepths[layerIdx + 1];
      }
    }

    offset += nSoundings;
  }

  // Merge preserved modelInfo with current metadata
  // Store flightline name mapping in model_info
  const flightlineMapping = {};
  flightlines.forEach((fl, idx) => {
    flightlineMapping[idx] = fl.name;
  });

  const baseModelInfo = modelInfo || {};
  const finalModelInfo = {
    ...baseModelInfo,
    created_by: 'AEM Model Simulator',
    created_at: new Date().toISOString(),
    num_flightlines: flightlines.length,
    flightline_names: flightlines.map(fl => fl.name).join(', '),
    flightline_mapping: flightlineMapping, // Map line_no -> name
    // Preserve projection if it exists, otherwise use from first flightline
    projection: baseModelInfo.projection || flightlines[0].model_info?.projection,
    coordinate_system: baseModelInfo.coordinate_system || flightlines[0].model_info?.coordinate_system
  };

  return {
    model_info: finalModelInfo,
    flightlines: {
      xdist: xdist,
      UTMX: utmx,  // ALC standard name
      UTMY: utmy,  // ALC standard name
      Topography: topo,  // ALC standard name
      TxAltitude: txAltitudeAboveGround,  // ALC standard name (ALTITUDE above ground, not elevation!)
      Line: line_no  // ALC standard name for line identifier (numeric IDs as typed array)
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
 * packBinary handles Maps with integer keys properly
 */
function createMsgpackBuffer(xyzData) {
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
