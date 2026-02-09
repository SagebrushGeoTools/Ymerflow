import React, { useState } from 'react';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';

const schema = {
  type: "object",
  properties: {
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
    layerThicknesses: {
      type: "string",
      title: "Layer thicknesses (m, comma-separated)",
      default: "1,1,2,5,10,20,50,100"
    },
    startingResistivity: {
      type: "number",
      title: "Starting resistivity (Ωm)",
      default: 100,
      minimum: 1,
      maximum: 5000
    },
    defaultAltitudeAboveGround: {
      type: "number",
      title: "Default altitude above ground (m)",
      default: 50,
      minimum: 10
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
    }
  },
  required: ["extent", "spacing", "layerThicknesses", "startingResistivity", "defaultAltitudeAboveGround", "utmStartX", "utmStartY", "utmBearing"]
};

function CreateModelDialog({ onClose, onCreate }) {
  const [formData, setFormData] = useState({
    extent: 1000,
    spacing: 10,
    layerThicknesses: "1,1,2,5,10,20,50,100",
    startingResistivity: 100,
    defaultAltitudeAboveGround: 50,
    utmStartX: 500000,
    utmStartY: 6000000,
    utmBearing: 90
  });

  const handleSubmit = ({ formData }) => {
    // Parse layer thicknesses
    const thicknesses = formData.layerThicknesses
      .split(',')
      .map(s => parseFloat(s.trim()))
      .filter(n => !isNaN(n) && n > 0);

    if (thicknesses.length === 0) {
      alert("Please enter valid layer thicknesses");
      return;
    }

    // Generate xdist array
    const nSoundings = Math.floor(formData.extent / formData.spacing) + 1;
    const xdist = [];
    for (let i = 0; i < nSoundings; i++) {
      xdist.push(i * formData.spacing);
    }

    // Generate UTM coordinates along bearing
    const bearingRad = (formData.utmBearing * Math.PI) / 180;
    const utmx = [];
    const utmy = [];
    for (let i = 0; i < nSoundings; i++) {
      const dist = i * formData.spacing;
      utmx.push(formData.utmStartX + dist * Math.sin(bearingRad));
      utmy.push(formData.utmStartY + dist * Math.cos(bearingRad));
    }

    // Calculate flight path ELEVATION (ground elevation + altitude above ground)
    const topo = new Array(nSoundings).fill(0); // Flat at elevation 0
    const flightElevation = topo.map(t => t + formData.defaultAltitudeAboveGround);

    // Initialize model data
    const modelData = {
      config: {
        extent: formData.extent,
        spacing: formData.spacing,
        layerThicknesses: thicknesses,
        defaultAltitudeAboveGround: formData.defaultAltitudeAboveGround,
        utmStartX: formData.utmStartX,
        utmStartY: formData.utmStartY,
        utmBearing: formData.utmBearing
      },
      xdist: xdist,
      utmx: utmx,
      utmy: utmy,
      topo: topo,
      flightElevation: flightElevation,  // ELEVATION (absolute), not altitude
      resistivity: thicknesses.map(() =>
        new Array(nSoundings).fill(formData.startingResistivity)
      )
    };

    onCreate(modelData);
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
        <h2>Create New AEM Model</h2>
        <Form
          schema={schema}
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
              Create
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

export default CreateModelDialog;
