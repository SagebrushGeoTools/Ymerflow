import React, { useState } from 'react';
import DatasetSelector from '../../jsoneditor/DatasetSelector';
import { loadDataset } from '../../datamodel/dataset';

/**
 * Dialog for loading an existing XYZ resistivity model dataset
 */
function LoadModelDialog({ onClose, onLoad }) {
  const [selectedDatasetUrl, setSelectedDatasetUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleLoad = async () => {
    if (!selectedDatasetUrl) {
      setError('Please select a dataset');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Extract dataset ID from URL - handle both old and new formats
      // Old format: http://localhost:8000/dataset/{id}
      // New format: http://localhost:8000/files/.../datasets/{id}/...
      let datasetId = null;

      // Try new format first
      let match = selectedDatasetUrl.match(/\/datasets\/([^/]+)\//);
      if (match) {
        datasetId = match[1];
      } else {
        // Try old format
        match = selectedDatasetUrl.match(/\/dataset\/([^/?]+)/);
        if (match) {
          datasetId = match[1];
        }
      }

      if (!datasetId) {
        throw new Error(`Invalid dataset URL format: ${selectedDatasetUrl}`);
      }

      // Load dataset
      const dataset = await loadDataset(datasetId);
      const xyzData = await dataset.getData('all');

      if (!xyzData || !xyzData.flightlines || !xyzData.layer_data) {
        throw new Error('Invalid XYZ dataset - missing required data');
      }

      // Parse XYZ data into flightline models
      const flightlines = parseXYZToFlightlines(xyzData, dataset.getParts());

      // Extract source process info from dataset metadata
      const sourceProcessInfo = {
        id: dataset.metadata.process_id,
        name: dataset.metadata.process_name,
        type: dataset.metadata.process_type
      };

      console.log('Loaded from process:', sourceProcessInfo);

      onLoad(flightlines, sourceProcessInfo);
      onClose();
    } catch (err) {
      console.error('Failed to load model:', err);
      setError(err.message || 'Failed to load dataset');
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '20px',
        borderRadius: '8px',
        maxWidth: '500px',
        width: '90%',
        maxHeight: '90vh',
        overflow: 'auto'
      }}>
        <h2>Load AEM Model</h2>
        <p style={{ color: '#6c757d', fontSize: '14px' }}>
          Select a resistivity model dataset (XYZ format) to load and edit.
        </p>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
            Dataset
          </label>
          <DatasetSelector
            value={selectedDatasetUrl}
            onChange={setSelectedDatasetUrl}
          />
        </div>

        {error && (
          <div style={{
            padding: '10px',
            marginBottom: '15px',
            backgroundColor: '#f8d7da',
            color: '#721c24',
            borderRadius: '4px',
            fontSize: '14px'
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
          <button
            onClick={handleLoad}
            disabled={loading}
            style={{
              padding: '8px 16px',
              backgroundColor: loading ? '#6c757d' : '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? 'Loading...' : 'Load'}
          </button>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              padding: '8px 16px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Parse XYZ dataset into flightline model objects
 */
function parseXYZToFlightlines(xyzData, parts) {
  console.log('parseXYZToFlightlines called with parts:', parts);
  const flightlines = [];

  // Check if dataset has parts - each part is a separate flightline
  const partNames = parts && parts.length > 0 ? parts : ['default'];
  console.log('Using part names:', partNames);

  partNames.forEach((partName, index) => {
    console.log(`Attempting to parse part ${partName} at index ${index}`);
    const flightline = parseXYZPartToFlightline(xyzData, partName, index);
    if (flightline) {
      flightlines.push(flightline);
      console.log(`Successfully added flightline ${partName}`);
    } else {
      console.warn(`Failed to parse flightline ${partName}`);
    }
  });

  // If no parts found or parsing failed, try to parse the whole dataset as one flightline
  if (flightlines.length === 0) {
    console.log('No flightlines parsed, trying to parse entire dataset as single flightline');
    const flightline = parseXYZPartToFlightline(xyzData, 'default', 0);
    if (flightline) {
      flightlines.push(flightline);
      console.log('Successfully parsed entire dataset as single flightline');
    } else {
      console.error('Failed to parse dataset as single flightline');
    }
  }

  console.log(`parseXYZToFlightlines returning ${flightlines.length} flightlines`);
  return flightlines;
}

/**
 * Parse a single XYZ part/flightline into model format
 */
function parseXYZPartToFlightline(xyzData, partName, index) {
  try {
    console.log(`Parsing part ${partName}:`, xyzData);
    console.log(`xyzData type:`, xyzData.constructor.name);

    const flightlinesData = xyzData.flightlines;
    const layerData = xyzData.layer_data;

    console.log(`flightlinesData:`, flightlinesData);
    console.log(`layerData:`, layerData);

    if (!flightlinesData || !flightlinesData.xdist || flightlinesData.xdist.length === 0) {
      console.warn(`Part ${partName} has no xdist data`);
      return null;
    }

    const nSoundings = flightlinesData.xdist.length;
    console.log(`Part ${partName} has ${nSoundings} soundings`);

    // Extract xdist array
    const xdist = Array.from(flightlinesData.xdist);

    // Extract UTM coordinates (try multiple column names)
    let utmx = null;
    let utmy = null;
    const utmxColumnNames = ['utmx', 'UTMX', 'easting', 'x'];
    const utmyColumnNames = ['utmy', 'UTMY', 'northing', 'y'];

    for (const colName of utmxColumnNames) {
      if (flightlinesData[colName]) {
        utmx = Array.from(flightlinesData[colName]);
        break;
      }
    }
    for (const colName of utmyColumnNames) {
      if (flightlinesData[colName]) {
        utmy = Array.from(flightlinesData[colName]);
        break;
      }
    }

    // If no UTM coordinates, generate defaults along bearing 90 degrees
    if (!utmx || !utmy) {
      const startX = 500000;
      const startY = 6000000;
      const bearing = 90 * Math.PI / 180;
      utmx = [];
      utmy = [];
      for (let i = 0; i < nSoundings; i++) {
        const dist = xdist[i];
        utmx.push(startX + dist * Math.sin(bearing));
        utmy.push(startY + dist * Math.cos(bearing));
      }
    }

    // Extract topography (try multiple column names)
    let topo = null;
    const topoColumnNames = ['topo', 'Topography', 'elevation', 'elev'];
    for (const colName of topoColumnNames) {
      if (flightlinesData[colName]) {
        topo = Array.from(flightlinesData[colName]);
        break;
      }
    }
    if (!topo) {
      topo = new Array(nSoundings).fill(0);
    }

    // Extract flight altitude above ground (TxAltitude = altitude above ground, NOT elevation)
    let txAltitudeAboveGround = null;
    const altColumnNames = ['TxAltitude', 'tx_altitude', 'altitude'];
    for (const colName of altColumnNames) {
      if (flightlinesData[colName]) {
        txAltitudeAboveGround = Array.from(flightlinesData[colName]);
        break;
      }
    }

    // Calculate flight path ELEVATION = ground elevation + altitude above ground
    const flightElevation = [];
    for (let i = 0; i < nSoundings; i++) {
      if (txAltitudeAboveGround) {
        flightElevation.push(topo[i] + txAltitudeAboveGround[i]);
      } else {
        flightElevation.push(topo[i] + 50); // Default 50m altitude above ground
      }
    }

    // Extract layer resistivity and thicknesses
    const resistivity = layerData.resistivity;
    const dep_top = layerData.dep_top;
    const dep_bot = layerData.dep_bot;

    console.log(`Part ${partName} layer_data keys:`, Object.keys(layerData));
    console.log(`Part ${partName} resistivity:`, resistivity);
    console.log(`Part ${partName} dep_top:`, dep_top);
    console.log(`Part ${partName} dep_bot:`, dep_bot);

    if (!resistivity || !dep_top || !dep_bot) {
      console.warn(`Part ${partName} missing layer data`);
      return null;
    }

    // Get layer indices (they're stored as string keys like "0", "1", "2"...)
    const layerIndices = Object.keys(resistivity).sort((a, b) => parseInt(a) - parseInt(b));
    const nLayers = layerIndices.length;

    console.log(`Part ${partName} layer indices:`, layerIndices);
    console.log(`Part ${partName} nLayers:`, nLayers);

    if (nLayers === 0) {
      console.warn(`Part ${partName} has no layers`);
      return null;
    }

    // Calculate layer thicknesses from dep_top and dep_bot
    // Use first sounding to get representative thicknesses
    const layerThicknesses = [];
    const validLayerIndices = []; // Track which layers we actually use

    for (const layerIdx of layerIndices) {
      const topArray = dep_top[layerIdx];
      const botArray = dep_bot[layerIdx];

      if (!topArray || !botArray || topArray.length === 0) {
        console.warn(`Part ${partName} layer ${layerIdx} missing depth data`);
        continue;
      }

      const top = Number(topArray[0]);
      const bot = Number(botArray[0]);

      // Handle infinite depth (common for last layer - half-space)
      if (!isFinite(bot)) {
        console.log(`Layer ${layerIdx}: top=${top}, bot=Infinity - skipping infinite half-space layer`);
        // Skip infinite layers - they can't be rendered
        continue;
      }

      const thickness = bot - top;

      console.log(`Layer ${layerIdx}: top=${top}, bot=${bot}, thickness=${thickness}`);
      layerThicknesses.push(thickness);
      validLayerIndices.push(layerIdx);
    }

    console.log(`Part ${partName} calculated layerThicknesses:`, layerThicknesses);
    console.log(`Part ${partName} valid layer indices (excluding infinite):`, validLayerIndices);

    // Extract resistivity values (only for valid layers, excluding infinite ones)
    const resistivityArrays = [];
    for (const layerIdx of validLayerIndices) {
      const resArray = resistivity[layerIdx];
      if (!resArray) {
        console.warn(`Part ${partName} layer ${layerIdx} missing resistivity data`);
        continue;
      }
      resistivityArrays.push(Array.from(resArray));
      console.log(`Layer ${layerIdx}: resistivity array length=${resArray.length}, first few values:`, Array.from(resArray).slice(0, 5));
    }

    console.log(`Part ${partName} extracted ${resistivityArrays.length} resistivity arrays`);

    // Calculate extent, spacing, and bearing
    const extent = xdist[xdist.length - 1] - xdist[0];
    const spacing = xdist.length > 1 ? (xdist[1] - xdist[0]) : 10;

    // Calculate bearing from UTM coordinates
    let bearing = 90; // default east
    if (utmx.length > 1 && utmy.length > 1) {
      const dx = utmx[utmx.length - 1] - utmx[0];
      const dy = utmy[utmy.length - 1] - utmy[0];
      bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    }

    const flightline = {
      id: `flightline_${index}`,
      name: partName === 'default' ? `Flightline ${index + 1}` : partName,
      config: {
        extent: extent,
        spacing: spacing,
        layerThicknesses: layerThicknesses,
        defaultFlightAltitude: 50,
        utmStartX: utmx[0],
        utmStartY: utmy[0],
        utmBearing: bearing
      },
      xdist: xdist,
      utmx: utmx,
      utmy: utmy,
      topo: topo,
      flightElevation: flightElevation,  // ELEVATION (absolute), not altitude
      resistivity: resistivityArrays
    };

    console.log(`Successfully parsed flightline ${partName}:`, flightline);
    console.log(`  - ${flightline.xdist.length} soundings`);
    console.log(`  - ${flightline.resistivity.length} layers`);
    console.log(`  - Layer thicknesses:`, flightline.config.layerThicknesses);
    console.log(`  - Topo range:`, Math.min(...topo), 'to', Math.max(...topo));

    return flightline;
  } catch (error) {
    console.error(`Failed to parse part ${partName}:`, error);
    console.error('Stack trace:', error.stack);
    return null;
  }
}

export default LoadModelDialog;
