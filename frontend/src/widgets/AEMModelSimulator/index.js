import React, { useState } from 'react';
import CreateModelDialog from './CreateModelDialog';
import LoadModelDialog from './LoadModelDialog';
import AddFlightlineDialog from './AddFlightlineDialog';
import SaveModelDialog from './SaveModelDialog';
import ModelCanvas from './ModelCanvas';
import BrushControls from './BrushControls';

function AEMModelSimulator() {
  // Multiple flightlines support
  const [flightlines, setFlightlines] = useState([]);
  const [currentFlightlineIndex, setCurrentFlightlineIndex] = useState(0);

  // Track source process for smart save (null if model was created, not loaded)
  const [sourceProcess, setSourceProcess] = useState(null);

  // Dialog states
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [showAddFlightlineDialog, setShowAddFlightlineDialog] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // Brush state
  const [brushRadius, setBrushRadius] = useState(20);
  const [brushSharpness, setBrushSharpness] = useState(0.5);
  const [currentResistivity, setCurrentResistivity] = useState(100);
  const [drawMode, setDrawMode] = useState('paint'); // 'paint' or 'terrain'

  const currentFlightline = flightlines.length > 0 ? flightlines[currentFlightlineIndex] : null;

  const handleCreateModel = (data) => {
    // Convert single model to flightline format
    const newFlightline = {
      id: 'flightline_0',
      name: 'Flightline 1',
      ...data
    };
    setFlightlines([newFlightline]);
    setCurrentFlightlineIndex(0);
    setSourceProcess(null); // New model, no source process
  };

  const handleLoadModel = (loadedFlightlines, sourceProcessInfo) => {
    setFlightlines(loadedFlightlines);
    setCurrentFlightlineIndex(0);
    setSourceProcess(sourceProcessInfo); // Track source for smart save
  };

  const handleAddFlightline = (newFlightline) => {
    setFlightlines([...flightlines, newFlightline]);
    setCurrentFlightlineIndex(flightlines.length);
  };

  const handleDeleteFlightline = () => {
    if (flightlines.length <= 1) {
      alert('Cannot delete the last flightline');
      return;
    }

    if (!window.confirm(`Delete flightline "${currentFlightline.name}"?`)) {
      return;
    }

    const newFlightlines = flightlines.filter((_, idx) => idx !== currentFlightlineIndex);
    setFlightlines(newFlightlines);
    setCurrentFlightlineIndex(Math.min(currentFlightlineIndex, newFlightlines.length - 1));
  };

  const handleSaveModel = () => {
    setShowSaveDialog(true);
  };

  const updateCurrentFlightline = (updatedData) => {
    const newFlightlines = [...flightlines];
    newFlightlines[currentFlightlineIndex] = {
      ...newFlightlines[currentFlightlineIndex],
      ...updatedData
    };
    setFlightlines(newFlightlines);
  };

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#ffffff'
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 15px',
        borderBottom: '1px solid #dee2e6',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#f8f9fa',
        gap: '10px'
      }}>
        <h2 style={{ margin: 0, fontSize: '18px' }}>AEM Model Simulator</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setShowCreateDialog(true)}
            style={{
              padding: '6px 12px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            New Model
          </button>
          <button
            onClick={() => setShowLoadDialog(true)}
            style={{
              padding: '6px 12px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Load Model
          </button>
          {flightlines.length > 0 && (
            <button
              onClick={handleSaveModel}
              style={{
                padding: '6px 12px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Save Model
            </button>
          )}
        </div>
      </div>

      {/* Flightline selector bar */}
      {flightlines.length > 0 && (
        <div style={{
          padding: '8px 15px',
          borderBottom: '1px solid #dee2e6',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          backgroundColor: '#f8f9fa'
        }}>
          <label style={{ fontWeight: 'bold', fontSize: '14px' }}>Flightline:</label>
          <select
            value={currentFlightlineIndex}
            onChange={(e) => setCurrentFlightlineIndex(parseInt(e.target.value))}
            style={{
              padding: '4px 8px',
              borderRadius: '4px',
              border: '1px solid #ced4da',
              fontSize: '14px'
            }}
          >
            {flightlines.map((fl, idx) => (
              <option key={fl.id} value={idx}>
                {fl.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowAddFlightlineDialog(true)}
            style={{
              padding: '4px 10px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            + Add
          </button>
          {flightlines.length > 1 && (
            <button
              onClick={handleDeleteFlightline}
              style={{
                padding: '4px 10px',
                backgroundColor: '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '13px'
              }}
            >
              Delete
            </button>
          )}
          <span style={{ marginLeft: 'auto', fontSize: '13px', color: '#6c757d' }}>
            {currentFlightline.xdist.length} soundings, {currentFlightline.resistivity.length} layers
          </span>
        </div>
      )}

      {/* Main content */}
      {currentFlightline ? (
        <div style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden'
        }}>
          {/* Canvas area */}
          <div style={{ flex: 1, position: 'relative' }}>
            <ModelCanvas
              modelData={currentFlightline}
              setModelData={updateCurrentFlightline}
              brushRadius={brushRadius}
              brushSharpness={brushSharpness}
              currentResistivity={currentResistivity}
              drawMode={drawMode}
            />
          </div>

          {/* Controls sidebar */}
          <BrushControls
            brushRadius={brushRadius}
            setBrushRadius={setBrushRadius}
            brushSharpness={brushSharpness}
            setBrushSharpness={setBrushSharpness}
            currentResistivity={currentResistivity}
            setCurrentResistivity={setCurrentResistivity}
            drawMode={drawMode}
            setDrawMode={setDrawMode}
          />
        </div>
      ) : (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#6c757d',
          fontSize: '16px'
        }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ marginBottom: '20px' }}>No model loaded</p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                onClick={() => setShowCreateDialog(true)}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '16px'
                }}
              >
                Create New Model
              </button>
              <button
                onClick={() => setShowLoadDialog(true)}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '16px'
                }}
              >
                Load Existing Model
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dialogs */}
      {showCreateDialog && (
        <CreateModelDialog
          onClose={() => setShowCreateDialog(false)}
          onCreate={handleCreateModel}
        />
      )}
      {showLoadDialog && (
        <LoadModelDialog
          onClose={() => setShowLoadDialog(false)}
          onLoad={handleLoadModel}
        />
      )}
      {showAddFlightlineDialog && (
        <AddFlightlineDialog
          onClose={() => setShowAddFlightlineDialog(false)}
          onCreate={handleAddFlightline}
          existingFlightlines={flightlines}
        />
      )}
      {showSaveDialog && (
        <SaveModelDialog
          onClose={() => setShowSaveDialog(false)}
          flightlines={flightlines}
          sourceProcess={sourceProcess}
        />
      )}
    </div>
  );
}

AEMModelSimulator.title = "AEM Model Simulator";

export default AEMModelSimulator;
