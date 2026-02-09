import React from 'react';

function BrushControls({
  brushRadius,
  setBrushRadius,
  brushSharpness,
  setBrushSharpness,
  currentResistivity,
  setCurrentResistivity,
  drawMode,
  setDrawMode
}) {
  // Convert resistivity to log scale for slider
  const logResistivity = Math.log10(Math.max(currentResistivity, 1));
  const minLog = 0; // 10^0 = 1
  const maxLog = 3.7; // 10^3.7 ≈ 5000

  const handleResistivityChange = (e) => {
    const logValue = parseFloat(e.target.value);
    setCurrentResistivity(Math.pow(10, logValue));
  };

  // Generate color bar ticks (powers of 10)
  const colorBarTicks = [];
  for (let exp = 0; exp <= 3; exp++) {
    const value = Math.pow(10, exp);
    const position = (exp / maxLog) * 100;
    colorBarTicks.push({ value, position });
  }
  colorBarTicks.push({ value: 5000, position: 100 });

  return (
    <div style={{
      width: '250px',
      padding: '15px',
      backgroundColor: '#f8f9fa',
      borderLeft: '1px solid #dee2e6',
      display: 'flex',
      flexDirection: 'column',
      gap: '20px',
      overflow: 'auto'
    }}>
      <h3 style={{ margin: '0 0 10px 0', fontSize: '16px' }}>Brush Controls</h3>

      {/* Drawing Mode Selector */}
      <div>
        <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: 'bold' }}>
          Drawing Mode
        </label>
        <div style={{ display: 'flex', gap: '5px' }}>
          <button
            onClick={() => setDrawMode('paint')}
            style={{
              flex: 1,
              padding: '8px',
              backgroundColor: drawMode === 'paint' ? '#007bff' : '#e9ecef',
              color: drawMode === 'paint' ? 'white' : '#495057',
              border: '1px solid #dee2e6',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: drawMode === 'paint' ? 'bold' : 'normal'
            }}
          >
            Paint
          </button>
          <button
            onClick={() => setDrawMode('terrain')}
            style={{
              flex: 1,
              padding: '8px',
              backgroundColor: drawMode === 'terrain' ? '#007bff' : '#e9ecef',
              color: drawMode === 'terrain' ? 'white' : '#495057',
              border: '1px solid #dee2e6',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: drawMode === 'terrain' ? 'bold' : 'normal'
            }}
          >
            Terrain
          </button>
        </div>
      </div>

      {/* Brush Radius */}
      <div>
        <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: 'bold' }}>
          Brush Radius: {brushRadius.toFixed(0)} m
        </label>
        <input
          type="range"
          min="5"
          max="100"
          step="1"
          value={brushRadius}
          onChange={e => setBrushRadius(parseFloat(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      {/* Brush Sharpness */}
      <div>
        <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: 'bold' }}>
          Brush Sharpness: {brushSharpness.toFixed(2)}
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={brushSharpness}
          onChange={e => setBrushSharpness(parseFloat(e.target.value))}
          style={{ width: '100%' }}
        />
        <div style={{ fontSize: '12px', color: '#6c757d', marginTop: '3px' }}>
          0 = soft, 1 = hard
        </div>
      </div>

      {/* Resistivity */}
      <div>
        <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: 'bold' }}>
          Resistivity: {currentResistivity.toFixed(1)} Ωm
        </label>
        <input
          type="range"
          min={minLog}
          max={maxLog}
          step="0.01"
          value={logResistivity}
          onChange={handleResistivityChange}
          style={{ width: '100%' }}
        />
      </div>

      {/* Color Bar */}
      <div>
        <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: 'bold' }}>
          Color Scale
        </label>
        <div style={{
          height: '200px',
          background: 'linear-gradient(to top, #000080, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000, #800000)',
          position: 'relative',
          borderRadius: '4px',
          border: '1px solid #dee2e6'
        }}>
          {colorBarTicks.map(({ value, position }, idx) => (
            <div key={idx} style={{
              position: 'absolute',
              bottom: `${position}%`,
              right: '5px',
              fontSize: '11px',
              backgroundColor: 'rgba(255,255,255,0.8)',
              padding: '1px 3px',
              borderRadius: '2px',
              transform: 'translateY(50%)'
            }}>
              {value >= 1000 ? `${(value/1000).toFixed(0)}k` : value}
            </div>
          ))}
        </div>
        <div style={{ fontSize: '12px', color: '#6c757d', marginTop: '5px', textAlign: 'center' }}>
          Resistivity (Ωm)
        </div>
      </div>

      {/* Instructions */}
      <div style={{
        fontSize: '12px',
        color: '#6c757d',
        borderTop: '1px solid #dee2e6',
        paddingTop: '10px'
      }}>
        <strong>Instructions:</strong>
        <ul style={{ paddingLeft: '20px', margin: '5px 0' }}>
          <li><strong>Paint mode:</strong> Click/drag to paint resistivity</li>
          <li><strong>Terrain mode:</strong> Drag topography (black) or altitude (red) lines</li>
          <li><strong>Pan:</strong> Shift+drag or middle mouse button</li>
          <li><strong>Zoom:</strong> Mouse wheel</li>
        </ul>
      </div>
    </div>
  );
}

export default BrushControls;
