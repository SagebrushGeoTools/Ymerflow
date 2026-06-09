import React, { useRef, useState } from 'react';
import { getColor, getGradientCSS, parseTblFile, COLORMAP_NAMES } from './utils/colormaps';

// Click-to-edit number label
function EditableValue({ value, onChange, format = (v) => v.toPrecision(3) }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = () => {
    const n = parseFloat(draft);
    if (!isNaN(n) && n > 0) onChange(n);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        value={draft}
        min="0.001"
        step="any"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        style={{ width: '70px', fontSize: '11px', padding: '1px 4px', border: '1px solid #007bff', borderRadius: '3px' }}
      />
    );
  }

  return (
    <span
      onClick={() => { setDraft(String(value)); setEditing(true); }}
      title="Click to edit"
      style={{ cursor: 'pointer', borderBottom: '1px dotted #666', fontSize: '11px', whiteSpace: 'nowrap' }}
    >
      {format(value)} Ω·m
    </span>
  );
}

function BrushControls({
  brushRadius,
  setBrushRadius,
  brushSharpness,
  setBrushSharpness,
  currentResistivity,
  setCurrentResistivity,
  drawMode,
  setDrawMode,
  rubberbandWidth,
  setRubberbandWidth,
  colormap,
  setColormap,
  vmin,
  setVmin,
  vmax,
  setVmax,
  customColormapData,
  setCustomColormapData,
}) {
  const fileRef = useRef(null);

  // Log-scale slider for brush resistivity (0.1 to 20000 Ω·m)
  const sliderMin = Math.log10(0.1);
  const sliderMax = Math.log10(20000);
  const logResistivity = Math.log10(Math.max(currentResistivity, 0.1));

  const colormapKey = colormap === 'custom' ? customColormapData : colormap;
  const brushColor = getColor(currentResistivity, vmin, vmax, colormapKey);
  const gradientCSS = getGradientCSS(colormapKey);

  const handleLoadTbl = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const lut = parseTblFile(ev.target.result);
      if (lut) {
        setCustomColormapData(lut);
        setColormap('custom');
      } else {
        alert('Could not parse .tbl file. Expected lines of "R G B" values (0–255).');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const fmtRes = (v) => {
    if (v >= 1000) return `${(v / 1000).toPrecision(3)}k`;
    if (v >= 1) return v.toPrecision(3);
    return v.toPrecision(2);
  };

  return (
    <div style={{
      width: '220px',
      padding: '15px',
      backgroundColor: '#f8f9fa',
      borderLeft: '1px solid #dee2e6',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      overflow: 'auto',
    }}>
      {/* Mode Tabs */}
      <div style={{ display: 'flex', gap: '5px' }}>
        {['paint', 'terrain'].map((mode) => (
          <button
            key={mode}
            onClick={() => setDrawMode(mode)}
            style={{
              flex: 1,
              padding: '8px',
              backgroundColor: drawMode === mode ? '#007bff' : '#e9ecef',
              color: drawMode === mode ? 'white' : '#495057',
              border: '1px solid #dee2e6',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: drawMode === mode ? 'bold' : 'normal',
              textTransform: 'capitalize',
            }}
          >
            {mode}
          </button>
        ))}
      </div>

      {/* Paint Mode Controls */}
      {drawMode === 'paint' && (
        <>
          {/* Brush Radius */}
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 'bold' }}>
              Brush Radius: {brushRadius.toFixed(0)} m
            </label>
            <input type="range" min="1" max="100" step="1" value={brushRadius}
              onChange={(e) => setBrushRadius(parseFloat(e.target.value))}
              style={{ width: '100%' }} />
          </div>

          {/* Brush Sharpness */}
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 'bold' }}>
              Sharpness: {brushSharpness.toFixed(2)}
            </label>
            <input type="range" min="0" max="1" step="0.01" value={brushSharpness}
              onChange={(e) => setBrushSharpness(parseFloat(e.target.value))}
              style={{ width: '100%' }} />
            <div style={{ fontSize: '11px', color: '#6c757d', marginTop: '2px' }}>0 = soft, 1 = hard</div>
          </div>

          {/* Brush Resistivity */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 'bold' }}>Resistivity</label>
              <div style={{ width: '16px', height: '16px', borderRadius: '3px', backgroundColor: brushColor, border: '1px solid #aaa', flexShrink: 0 }} />
              <EditableValue
                value={currentResistivity}
                onChange={setCurrentResistivity}
                format={fmtRes}
              />
            </div>
            <input
              type="range"
              min={sliderMin}
              max={sliderMax}
              step="0.01"
              value={logResistivity}
              onChange={(e) => setCurrentResistivity(Math.pow(10, parseFloat(e.target.value)))}
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#6c757d' }}>
              <span>0.1</span><span>1</span><span>10</span><span>100</span><span>1k</span><span>10k</span>
            </div>
          </div>

          {/* Colormap */}
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 'bold' }}>
              Colormap
            </label>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <select
                value={colormap}
                onChange={(e) => setColormap(e.target.value)}
                style={{ flex: 1, padding: '4px', fontSize: '13px', borderRadius: '4px', border: '1px solid #ced4da' }}
              >
                {COLORMAP_NAMES.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
                {customColormapData && <option value="custom">custom (.tbl)</option>}
              </select>
              <button
                onClick={() => fileRef.current.click()}
                title="Load .tbl colormap file"
                style={{ padding: '4px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid #ced4da', cursor: 'pointer', backgroundColor: '#fff', whiteSpace: 'nowrap' }}
              >
                .tbl
              </button>
              <input ref={fileRef} type="file" accept=".tbl" onChange={handleLoadTbl} style={{ display: 'none' }} />
            </div>
          </div>

          {/* Colorbar */}
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 'bold' }}>
              Color Scale
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
              {/* Gradient bar */}
              <div style={{
                width: '28px',
                flexShrink: 0,
                background: gradientCSS,
                borderRadius: '4px',
                border: '1px solid #dee2e6',
                minHeight: '160px',
              }} />
              {/* Min/max labels */}
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', paddingTop: '2px', paddingBottom: '2px' }}>
                <EditableValue value={vmax} onChange={setVmax} format={fmtRes} />
                <EditableValue value={vmin} onChange={setVmin} format={fmtRes} />
              </div>
            </div>
            <div style={{ fontSize: '11px', color: '#6c757d', marginTop: '4px', textAlign: 'center' }}>
              Resistivity (Ω·m)
            </div>
          </div>
        </>
      )}

      {/* Terrain Mode Controls */}
      {drawMode === 'terrain' && (
        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 'bold' }}>
            Rubberband Width: {rubberbandWidth.toFixed(0)} soundings
          </label>
          <input type="range" min="1" max="50" step="1" value={rubberbandWidth}
            onChange={(e) => setRubberbandWidth(parseFloat(e.target.value))}
            style={{ width: '100%' }} />
          <div style={{ fontSize: '11px', color: '#6c757d', marginTop: '3px' }}>
            Controls how far the terrain adjustment spreads
          </div>
        </div>
      )}
    </div>
  );
}

export default BrushControls;
