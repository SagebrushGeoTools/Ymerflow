import React, { useState } from 'react';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import { XYZ } from '../../datamodel/libaarhusxyz';
import { packBinary } from 'msgpack-numpy-js';

const schema = {
  type: "object",
  properties: {
    name: {
      type: "string",
      title: "Flightline Name",
      default: ""
    },
    extent: {
      type: "number",
      title: "Distance extent (m)",
      default: 1000,
      minimum: 100
    },
    spacing: {
      type: "number",
      title: "Sounding spacing (m)",
      default: 10,
      minimum: 1
    },
    copyFrom: {
      type: "string",
      title: "Copy settings from",
      enum: ["none"],
      default: "none"
    },
    utmStartX: {
      type: "number",
      title: "Starting UTM X (easting)",
      default: 500000
    },
    utmStartY: {
      type: "number",
      title: "Starting UTM Y (northing)",
      default: 6000000
    },
    utmBearing: {
      type: "number",
      title: "Flightline bearing (degrees from north)",
      default: 90,
      minimum: 0,
      maximum: 360
    },
    offsetFromLast: {
      type: "number",
      title: "Offset from last flightline (m, perpendicular)",
      default: 100,
      minimum: 0
    }
  },
  required: ["extent", "spacing"]
};

function AddFlightlineDialog({ onClose, onCreate, existingFlightlines }) {
  // Calculate defaults based on last flightline (XYZ object)
  const lastFlightline = existingFlightlines.length > 0
    ? existingFlightlines[existingFlightlines.length - 1]
    : null;

  // Extract defaults from last XYZ object
  let defaultUtmStartX = 500000;
  let defaultUtmStartY = 6000000;
  let defaultBearing = 90;
  let defaultExtent = 1000;
  let defaultSpacing = 10;

  if (lastFlightline) {
    const utmx = lastFlightline.flightlines.UTMX;
    const utmy = lastFlightline.flightlines.UTMY;
    const xdist = lastFlightline.flightlines.xdist;

    defaultExtent = xdist[xdist.length - 1] - xdist[0];
    defaultSpacing = xdist.length > 1 ? (xdist[1] - xdist[0]) : 10;

    if (utmx.length > 1 && utmy.length > 1) {
      const dx = utmx[utmx.length - 1] - utmx[0];
      const dy = utmy[utmy.length - 1] - utmy[0];
      defaultBearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    }

    // Offset 100m perpendicular to bearing
    const bearingRad = (defaultBearing * Math.PI) / 180;
    const perpendicularRad = bearingRad + Math.PI / 2;
    defaultUtmStartX = utmx[0] + 100 * Math.cos(perpendicularRad);
    defaultUtmStartY = utmy[0] + 100 * Math.sin(perpendicularRad);
  }

  // Build schema with existing flightlines for copying
  const dynamicSchema = { ...schema };
  if (existingFlightlines && existingFlightlines.length > 0) {
    dynamicSchema.properties.copyFrom.enum = [
      "none",
      ...existingFlightlines.map((fl, idx) => `flightline_${idx}`)
    ];
    dynamicSchema.properties.copyFrom.enumNames = [
      "None (use defaults)",
      ...existingFlightlines.map((xyz, idx) => xyz.info.flightline_name || `Flightline ${idx + 1}`)
    ];
  }

  const [formData, setFormData] = useState({
    name: `Flightline ${existingFlightlines.length + 1}`,
    extent: defaultExtent,
    spacing: defaultSpacing,
    copyFrom: "none",
    utmStartX: defaultUtmStartX,
    utmStartY: defaultUtmStartY,
    utmBearing: defaultBearing,
    offsetFromLast: 100
  });

  const handleSubmit = ({ formData }) => {
    // Find flightline to copy from (if any)
    let baseXyz = null;
    if (formData.copyFrom !== "none") {
      const idx = parseInt(formData.copyFrom.split('_')[1]);
      baseXyz = existingFlightlines[idx];
    }

    // Generate xdist array
    const nSoundings = Math.floor(formData.extent / formData.spacing) + 1;
    const xdist = new Float64Array(nSoundings);
    for (let i = 0; i < nSoundings; i++) {
      xdist[i] = i * formData.spacing;
    }

    // Calculate UTM coordinates
    // If offsetFromLast is specified and we have a previous flightline, offset perpendicular to bearing
    let utmStartX = formData.utmStartX;
    let utmStartY = formData.utmStartY;

    if (formData.offsetFromLast && lastFlightline) {
      const bearing = formData.utmBearing;
      const bearingRad = (bearing * Math.PI) / 180;
      const perpendicularRad = bearingRad + Math.PI / 2;

      const lastUtmx = lastFlightline.flightlines.UTMX;
      const lastUtmy = lastFlightline.flightlines.UTMY;
      utmStartX = lastUtmx[0] + formData.offsetFromLast * Math.cos(perpendicularRad);
      utmStartY = lastUtmy[0] + formData.offsetFromLast * Math.sin(perpendicularRad);
    }

    // Generate UTM coordinates along bearing
    const bearingRad = (formData.utmBearing * Math.PI) / 180;
    const utmx = new Float64Array(nSoundings);
    const utmy = new Float64Array(nSoundings);
    for (let i = 0; i < nSoundings; i++) {
      const dist = i * formData.spacing;
      utmx[i] = utmStartX + dist * Math.sin(bearingRad);
      utmy[i] = utmStartY + dist * Math.cos(bearingRad);
    }

    // Determine layer structure (copy from base or use defaults)
    let layerThicknesses, defaultAltitude, projection, coordinateSystem;
    if (baseXyz) {
      // Extract from base XYZ
      const nLayers = (baseXyz.layer_data.rho ?? baseXyz.layer_data.resistivity).size;
      layerThicknesses = [];
      for (let i = 0; i < nLayers; i++) {
        const top = baseXyz.layer_data.dep_top.get(i)[0];
        const bot = baseXyz.layer_data.dep_bot.get(i)[0];
        layerThicknesses.push(bot - top);
      }
      defaultAltitude = baseXyz.flightlines.TxAltitude[0];
      projection = baseXyz.info.projection;
      coordinateSystem = baseXyz.info.coordinate_system;
    } else {
      layerThicknesses = [1, 1, 2, 5, 10, 20, 50, 100];
      defaultAltitude = 50;
      projection = lastFlightline?.info.projection || 25833;
      coordinateSystem = lastFlightline?.info.coordinate_system || `EPSG:${projection}`;
    }

    // Create flightline data
    const topo = new Float64Array(nSoundings).fill(0);
    const txAltitude = new Float64Array(nSoundings).fill(defaultAltitude);
    const line = new Int32Array(nSoundings).fill(0);

    // Calculate layer depths and create layer data
    let cumDepth = 0;
    const layerDepths = [0];
    for (const thickness of layerThicknesses) {
      cumDepth += thickness;
      layerDepths.push(cumDepth);
    }

    // Build layer_data with Maps
    const resistivity = new Map();
    const dep_top = new Map();
    const dep_bot = new Map();

    for (let layerIdx = 0; layerIdx < layerThicknesses.length; layerIdx++) {
      // Copy resistivity from base or use default
      const resArray = new Float64Array(nSoundings);
      const baseRes = baseXyz ? (baseXyz.layer_data.rho ?? baseXyz.layer_data.resistivity) : null;
      if (baseRes && baseRes.has(layerIdx)) {
        // Use first sounding's resistivity as default for all soundings
        resArray.fill(baseRes.get(layerIdx)[0]);
      } else {
        resArray.fill(100);
      }
      resistivity.set(layerIdx, resArray);

      // Depth top and bottom
      const topArray = new Float64Array(nSoundings);
      const botArray = new Float64Array(nSoundings);
      topArray.fill(layerDepths[layerIdx]);
      botArray.fill(layerDepths[layerIdx + 1]);
      dep_top.set(layerIdx, topArray);
      dep_bot.set(layerIdx, botArray);
    }

    // Build XYZ data structure
    const xyzData = {
      model_info: {
        projection,
        coordinate_system: coordinateSystem,
        created_by: 'AEM Model Simulator',
        created_at: new Date().toISOString(),
        flightline_name: formData.name || `Flightline ${existingFlightlines.length + 1}`
      },
      flightlines: {
        xdist: xdist,
        UTMX: utmx,
        UTMY: utmy,
        Topography: topo,
        TxAltitude: txAltitude,
        Line: line
      },
      layer_data: {
        rho: resistivity,
        dep_top: dep_top,
        dep_bot: dep_bot
      },
      system: baseXyz?.system || {}
    };

    // Create XYZ object
    const xyz = new XYZ(packBinary(xyzData));

    onCreate(xyz);
    onClose();
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
        <h2>Add Flightline</h2>
        <Form
          schema={dynamicSchema}
          formData={formData}
          validator={validator}
          onChange={e => setFormData(e.formData)}
          onSubmit={handleSubmit}
        >
          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <button type="submit" style={{
              padding: '8px 16px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}>
              Add
            </button>
            <button type="button" onClick={onClose} style={{
              padding: '8px 16px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}>
              Cancel
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}

export default AddFlightlineDialog;
