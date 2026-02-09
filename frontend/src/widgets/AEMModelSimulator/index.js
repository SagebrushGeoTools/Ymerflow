import React, { useState } from 'react';
import CreateModelDialog from './CreateModelDialog';
import ModelCanvas from './ModelCanvas';
import BrushControls from './BrushControls';

function AEMModelSimulator() {
  const [modelData, setModelData] = useState(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Brush state
  const [brushRadius, setBrushRadius] = useState(20);
  const [brushSharpness, setBrushSharpness] = useState(0.5);
  const [currentResistivity, setCurrentResistivity] = useState(100);
  const [drawMode, setDrawMode] = useState('paint'); // 'paint' or 'terrain'

  const handleCreateModel = (data) => {
    setModelData(data);
  };

  const handleNewModel = () => {
    setShowCreateDialog(true);
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
        backgroundColor: '#f8f9fa'
      }}>
        <h2 style={{ margin: 0, fontSize: '18px' }}>AEM Model Simulator</h2>
        <button
          onClick={handleNewModel}
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
          {modelData ? 'New Model' : 'Create Model'}
        </button>
      </div>

      {/* Main content */}
      {modelData ? (
        <div style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden'
        }}>
          {/* Canvas area */}
          <div style={{ flex: 1, position: 'relative' }}>
            <ModelCanvas
              modelData={modelData}
              setModelData={setModelData}
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
            <button
              onClick={handleNewModel}
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
              Create New Model
            </button>
          </div>
        </div>
      )}

      {/* Create dialog */}
      {showCreateDialog && (
        <CreateModelDialog
          onClose={() => setShowCreateDialog(false)}
          onCreate={handleCreateModel}
        />
      )}
    </div>
  );
}

AEMModelSimulator.title = "AEM Model Simulator";

export default AEMModelSimulator;
