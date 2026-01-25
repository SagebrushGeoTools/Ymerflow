import React from 'react';
import { Handle, Position } from 'reactflow';

export default function ProcessNode({ data }) {
  const { process, selectedVersion, onVersionChange, onClick, activeProcess } = data;

  // Check if this node is the currently selected process
  const isSelected = activeProcess?.processId === process.id;

  // Get the current version object
  const versionObj = process.versions?.find(v => v.version === selectedVersion);

  // Extract unique input parameters from dependencies
  const inputParams = [];
  if (versionObj?.dependencies && Array.isArray(versionObj.dependencies)) {
    const uniqueParams = new Set();
    versionObj.dependencies.forEach(dep => {
      if (!uniqueParams.has(dep.target_param_name)) {
        uniqueParams.add(dep.target_param_name);
        inputParams.push(dep.target_param_name);
      }
    });
  }

  // Extract output names from outputs object
  const outputNames = versionObj?.outputs ? Object.keys(versionObj.outputs) : [];

  const handleSpacing = 16;
  const labelWidth = 45;
  const labelHeight = 12;

  const labelStyle = {
    background: '#f8f9fa',
    border: '1px solid #aaa',
    borderRadius: '1px',
    padding: '0px 2px',
    fontSize: '6px',
    color: '#555',
    whiteSpace: 'nowrap',
    width: `${labelWidth}px`,
    height: `${labelHeight}px`,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    textAlign: 'center',
    lineHeight: `${labelHeight}px`,
    pointerEvents: 'none'
  };

  return (
    <div
      className="card"
      style={{
        cursor: "pointer",
        minWidth: 150,
        minHeight: 100,
        position: 'relative',
        paddingLeft: '45px',
        paddingRight: '45px',
        paddingTop: '5px',
        paddingBottom: '5px',
        border: isSelected ? '3px solid #0d6efd' : undefined,
        boxShadow: isSelected ? '0 0 10px rgba(13, 110, 253, 0.3)' : undefined
      }}
      onClick={onClick}
    >
      {/* Input handles on the left */}
      {inputParams.map((param, idx) => (
        <div
          key={`input-${param}`}
          style={{
            position: 'absolute',
            left: `0px`,
            top: `${15 + idx * handleSpacing}px`,
            ...labelStyle
          }}
          title={param}
        >
          {param}
          <Handle
            type="target"
            position={Position.Left}
            id={param}
            style={{
              position: 'absolute',
              left: `0px`,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'transparent',
              border: 'none',
              width: 10,
              height: 10
            }}
          />
        </div>
      ))}

      {/* Output handles on the right */}
      {outputNames.map((name, idx) => (
        <div
          key={`output-${name}`}
          style={{
            position: 'absolute',
            right: `0px`,
            top: `${15 + idx * handleSpacing}px`,
            ...labelStyle
          }}
          title={name}
        >
          {name}
          <Handle
            type="source"
            position={Position.Right}
            id={name}
            style={{
              position: 'absolute',
              right: `0px`,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'transparent',
              border: 'none',
              width: 10,
              height: 10
            }}
          />
        </div>
      ))}

      <strong>
        {process.name}
        &nbsp;
        <select
          value={selectedVersion}
          onChange={(e) => {
            e.stopPropagation();
            onVersionChange(process.id, parseInt(e.target.value));
          }}
          onClick={(e) => e.stopPropagation()}
          style={{ width: 'auto', minWidth: '60px' }}
        >
          {process.versions?.map(v => (
            <option key={v.version} value={v.version}>v{v.version}</option>
          ))}
        </select>
        &nbsp;
        {versionObj?.state === "queued" && <span className="badge bg-warning">Queued</span>}
        {versionObj?.state === "running" && <span className="badge bg-primary">Running</span>}
        {versionObj?.state === "done" && <span className="badge bg-success">Done</span>}        
      </strong>
      <div className="text-muted small">
        {process.type}
      </div>
    </div>
  );
}
