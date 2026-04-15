import React, { useState, useEffect } from 'react';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import EPSGSelector from '../../jsoneditor/EPSGSelector';
import { XYZ } from '../../datamodel/libaarhusxyz';
import { packBinary, unpackBinary } from 'msgpack-numpy-js';
import { API } from '../../datamodel/api';

function CreateModelDialog({ onClose, onCreate }) {
  const [systems, setSystems] = useState([]);
  const [formData, setFormData] = useState({
    system: null,
    extent: 1000,
    spacing: 10,
    defaultAltitudeAboveGround: 50,
    projection: 25833,
    utmStartX: 500000,
    utmStartY: 6000000,
    utmBearing: 90
  });

  // Fetch systems on mount
  useEffect(() => {
    console.log('Fetching systems...');
    fetch(`${API}/systems`)
      .then(res => {
        console.log('Systems response status:', res.status);
        return res.arrayBuffer();
      })
      .then(buffer => {
        // Decode msgpack response (preserves numpy arrays)
        const data = unpackBinary(new Uint8Array(buffer));
        console.log('Systems data:', data);
        setSystems(data);
        if (data.length > 0) {
          setFormData(prev => ({ ...prev, system: data[0].id }));
        }
      })
      .catch(err => console.error('Failed to fetch systems:', err));
  }, []);

  // Build schema dynamically based on available systems
  const schemaProperties = {
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
    };

  // Add system selector if systems are available
  if (systems.length > 0) {
    console.log('Full systems data:', systems);

    schemaProperties.system = {
      type: "string",
      title: "Survey System",
      oneOf: systems.map(s => ({
        const: s.id,
        title: s.name
      }))
    };

    console.log('System field oneOf:', schemaProperties.system.oneOf);
  }

  const schema = {
    type: "object",
    properties: schemaProperties,
    required: ["extent", "spacing", "defaultAltitudeAboveGround", "utmStartX", "utmStartY", "utmBearing"]
  };

  console.log('Final schema.properties.system:', schema.properties.system);

  const [layers, setLayers] = useState([
    { thickness: 1, resistivity: 100 },
    { thickness: 1, resistivity: 100 },
    { thickness: 2, resistivity: 100 },
    { thickness: 5, resistivity: 100 },
    { thickness: 10, resistivity: 100 },
    { thickness: 20, resistivity: 100 },
    { thickness: 50, resistivity: 100 },
    { thickness: 100, resistivity: 100 }
  ]);

  const handleLayerChange = (index, field, value) => {
    const newLayers = [...layers];
    newLayers[index][field] = parseFloat(value) || 0;
    setLayers(newLayers);
  };

  const handleAddLayer = () => {
    const lastLayer = layers[layers.length - 1];
    setLayers([...layers, { ...lastLayer }]);
  };

  const handleRemoveLayer = (index) => {
    if (layers.length <= 1) {
      alert("Must have at least one layer");
      return;
    }
    setLayers(layers.filter((_, i) => i !== index));
  };

  const handleSubmit = ({ formData: basicFormData }) => {
    // Validate layers
    const validLayers = layers.filter(l => l.thickness > 0 && l.resistivity > 0);
    if (validLayers.length === 0) {
      alert("Please enter valid layer thicknesses and resistivities");
      return;
    }

    // Find selected system
    const selectedSystem = systems.find(s => s.id === basicFormData.system);

    // Generate xdist array
    const nSoundings = Math.floor(basicFormData.extent / basicFormData.spacing) + 1;
    const xdist = new Float64Array(nSoundings);
    for (let i = 0; i < nSoundings; i++) {
      xdist[i] = i * basicFormData.spacing;
    }

    // Generate UTM coordinates along bearing
    const bearingRad = (basicFormData.utmBearing * Math.PI) / 180;
    const utmx = new Float64Array(nSoundings);
    const utmy = new Float64Array(nSoundings);
    for (let i = 0; i < nSoundings; i++) {
      const dist = i * basicFormData.spacing;
      utmx[i] = basicFormData.utmStartX + dist * Math.sin(bearingRad);
      utmy[i] = basicFormData.utmStartY + dist * Math.cos(bearingRad);
    }

    // Calculate topography and flight altitude
    const topo = new Float64Array(nSoundings).fill(0); // Flat at elevation 0
    const txAltitude = new Float64Array(nSoundings).fill(basicFormData.defaultAltitudeAboveGround);

    // Line column (all 0s for single flightline)
    const line = new Int32Array(nSoundings).fill(0);

    // Calculate layer depths and create layer data
    const thicknesses = validLayers.map(l => l.thickness);
    let cumDepth = 0;
    const layerDepths = [0];
    for (const thickness of thicknesses) {
      cumDepth += thickness;
      layerDepths.push(cumDepth);
    }

    // Build layer_data with plain objects (Maps can't be serialized by packBinary)
    const resistivity = {};
    const dep_top = {};
    const dep_bot = {};

    for (let layerIdx = 0; layerIdx < validLayers.length; layerIdx++) {
      // Resistivity for this layer
      const resArray = new Float64Array(nSoundings);
      resArray.fill(validLayers[layerIdx].resistivity);
      resistivity[layerIdx] = resArray;

      // Depth top and bottom
      const topArray = new Float64Array(nSoundings);
      const botArray = new Float64Array(nSoundings);
      topArray.fill(layerDepths[layerIdx]);
      botArray.fill(layerDepths[layerIdx + 1]);
      dep_top[layerIdx] = topArray;
      dep_bot[layerIdx] = botArray;
    }

    // Build XYZ data structure
    const xyzData = {
      model_info: {
        projection: basicFormData.projection,
        coordinate_system: `EPSG:${basicFormData.projection}`,
        created_by: 'AEM Model Simulator',
        created_at: new Date().toISOString(),
        flightline_name: 'Flightline 1'
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
      system: selectedSystem ? selectedSystem.gex : {}
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
        maxWidth: '600px',
        width: '90%',
        maxHeight: '90vh',
        overflow: 'auto'
      }}>
        <h2>Create New AEM Model</h2>

        {/* EPSG Code Selector (outside of JSON Schema Form) */}
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
            Coordinate System (EPSG) <span style={{ color: '#dc3545' }}>*</span>
          </label>
          <EPSGSelector
            value={formData.projection}
            onChange={(code) => setFormData({ ...formData, projection: code })}
            required={true}
          />
        </div>

        <Form
          key={`form-${systems.length}`}
          schema={schema}
          formData={formData}
          validator={validator}
          onChange={e => setFormData(e.formData)}
          onSubmit={handleSubmit}
        >
          {/* Layers Table */}
          <div style={{ marginTop: '20px', marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '10px', fontSize: '14px', fontWeight: 'bold' }}>
              Layers
            </label>
            <div style={{
              border: '1px solid #dee2e6',
              borderRadius: '4px',
              overflow: 'hidden'
            }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '14px'
              }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8f9fa' }}>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #dee2e6' }}>
                      Thickness (m)
                    </th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #dee2e6' }}>
                      Resistivity (Ωm)
                    </th>
                    <th style={{ padding: '8px', width: '50px', borderBottom: '2px solid #dee2e6' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {layers.map((layer, index) => (
                    <tr key={index} style={{ borderBottom: '1px solid #dee2e6' }}>
                      <td style={{ padding: '4px' }}>
                        <input
                          type="number"
                          value={layer.thickness}
                          onChange={e => handleLayerChange(index, 'thickness', e.target.value)}
                          min="0.1"
                          step="0.1"
                          style={{
                            width: '100%',
                            padding: '6px',
                            border: '1px solid #ced4da',
                            borderRadius: '4px',
                            fontSize: '14px'
                          }}
                        />
                      </td>
                      <td style={{ padding: '4px' }}>
                        <input
                          type="number"
                          value={layer.resistivity}
                          onChange={e => handleLayerChange(index, 'resistivity', e.target.value)}
                          min="1"
                          step="1"
                          style={{
                            width: '100%',
                            padding: '6px',
                            border: '1px solid #ced4da',
                            borderRadius: '4px',
                            fontSize: '14px'
                          }}
                        />
                      </td>
                      <td style={{ padding: '4px', textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => handleRemoveLayer(index)}
                          disabled={layers.length <= 1}
                          style={{
                            padding: '4px 8px',
                            backgroundColor: layers.length <= 1 ? '#e9ecef' : '#dc3545',
                            color: layers.length <= 1 ? '#6c757d' : 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: layers.length <= 1 ? 'not-allowed' : 'pointer',
                            fontSize: '16px',
                            lineHeight: '1'
                          }}
                          title="Remove layer"
                        >
                          −
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={handleAddLayer}
              style={{
                marginTop: '8px',
                padding: '6px 12px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <span style={{ fontSize: '18px', lineHeight: '1' }}>+</span>
              Add Layer
            </button>
          </div>

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
