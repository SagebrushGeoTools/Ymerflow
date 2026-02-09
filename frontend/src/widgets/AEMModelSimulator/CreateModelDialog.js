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
    defaultFlightAltitude: {
      type: "number",
      title: "Default flight altitude (m)",
      default: 50,
      minimum: 10
    }
  },
  required: ["extent", "spacing", "layerThicknesses", "startingResistivity", "defaultFlightAltitude"]
};

function CreateModelDialog({ onClose, onCreate }) {
  const [formData, setFormData] = useState({
    extent: 1000,
    spacing: 10,
    layerThicknesses: "1,1,2,5,10,20,50,100",
    startingResistivity: 100,
    defaultFlightAltitude: 50
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

    // Initialize model data
    const modelData = {
      config: {
        extent: formData.extent,
        spacing: formData.spacing,
        layerThicknesses: thicknesses,
        defaultFlightAltitude: formData.defaultFlightAltitude
      },
      xdist: xdist,
      topo: new Array(nSoundings).fill(0), // Flat at elevation 0
      flightAltitude: new Array(nSoundings).fill(formData.defaultFlightAltitude),
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
