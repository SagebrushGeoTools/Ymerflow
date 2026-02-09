import React, { useState } from 'react';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';

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
  // Calculate defaults based on last flightline
  const lastFlightline = existingFlightlines.length > 0
    ? existingFlightlines[existingFlightlines.length - 1]
    : null;

  const defaultUtmStartX = lastFlightline
    ? lastFlightline.utmx[0] + 100 * Math.cos((lastFlightline.config.utmBearing || 90) * Math.PI / 180)
    : 500000;
  const defaultUtmStartY = lastFlightline
    ? lastFlightline.utmy[0] - 100 * Math.sin((lastFlightline.config.utmBearing || 90) * Math.PI / 180)
    : 6000000;
  const defaultBearing = lastFlightline ? (lastFlightline.config.utmBearing || 90) : 90;

  // Build schema with existing flightlines for copying
  const dynamicSchema = { ...schema };
  if (existingFlightlines && existingFlightlines.length > 0) {
    dynamicSchema.properties.copyFrom.enum = [
      "none",
      ...existingFlightlines.map((fl, idx) => `flightline_${idx}`)
    ];
    dynamicSchema.properties.copyFrom.enumNames = [
      "None (use defaults)",
      ...existingFlightlines.map(fl => fl.name)
    ];
  }

  const [formData, setFormData] = useState({
    name: `Flightline ${existingFlightlines.length + 1}`,
    extent: lastFlightline ? lastFlightline.config.extent : 1000,
    spacing: lastFlightline ? lastFlightline.config.spacing : 10,
    copyFrom: "none",
    utmStartX: defaultUtmStartX,
    utmStartY: defaultUtmStartY,
    utmBearing: defaultBearing,
    offsetFromLast: 100
  });

  const handleSubmit = ({ formData }) => {
    // Find flightline to copy from (if any)
    let baseFlightline = null;
    if (formData.copyFrom !== "none") {
      const idx = parseInt(formData.copyFrom.split('_')[1]);
      baseFlightline = existingFlightlines[idx];
    }

    // Generate xdist array
    const nSoundings = Math.floor(formData.extent / formData.spacing) + 1;
    const xdist = [];
    for (let i = 0; i < nSoundings; i++) {
      xdist.push(i * formData.spacing);
    }

    // Calculate UTM coordinates
    // If offsetFromLast is specified and we have a previous flightline, offset perpendicular to bearing
    let utmStartX = formData.utmStartX;
    let utmStartY = formData.utmStartY;

    if (formData.offsetFromLast && lastFlightline) {
      const bearing = formData.utmBearing;
      const bearingRad = (bearing * Math.PI) / 180;
      const perpendicularRad = bearingRad + Math.PI / 2; // 90 degrees clockwise

      utmStartX = lastFlightline.utmx[0] + formData.offsetFromLast * Math.cos(perpendicularRad);
      utmStartY = lastFlightline.utmy[0] + formData.offsetFromLast * Math.sin(perpendicularRad);
    }

    // Generate UTM coordinates along bearing
    const bearingRad = (formData.utmBearing * Math.PI) / 180;
    const utmx = [];
    const utmy = [];
    for (let i = 0; i < nSoundings; i++) {
      const dist = i * formData.spacing;
      utmx.push(utmStartX + dist * Math.sin(bearingRad));
      utmy.push(utmStartY + dist * Math.cos(bearingRad));
    }

    // Create new flightline
    const newFlightline = {
      id: `flightline_${Date.now()}`,
      name: formData.name || `Flightline ${existingFlightlines.length + 1}`,
      config: baseFlightline ? {
        ...baseFlightline.config,
        extent: formData.extent,
        spacing: formData.spacing,
        utmStartX: utmStartX,
        utmStartY: utmStartY,
        utmBearing: formData.utmBearing
      } : {
        extent: formData.extent,
        spacing: formData.spacing,
        layerThicknesses: [1, 1, 2, 5, 10, 20, 50, 100],
        defaultAltitudeAboveGround: 50,
        utmStartX: utmStartX,
        utmStartY: utmStartY,
        utmBearing: formData.utmBearing
      },
      xdist: xdist,
      utmx: utmx,
      utmy: utmy,
      topo: new Array(nSoundings).fill(0),
      flightElevation: new Array(nSoundings).fill(
        baseFlightline ? (baseFlightline.config.defaultAltitudeAboveGround || 50) : 50
      ),  // ELEVATION (starts at 0 + 50 = 50m elevation for flat ground)
      resistivity: (baseFlightline ? baseFlightline.config.layerThicknesses : [1, 1, 2, 5, 10, 20, 50, 100]).map(() =>
        new Array(nSoundings).fill(100)
      )
    };

    onCreate(newFlightline);
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
