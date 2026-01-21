import React, { useContext } from "react";
import ReactFlow, { Background } from "reactflow";
import 'reactflow/dist/style.css';
import { ProcessContext } from './ProcessContext';

export default function FlowView({}) {
  const {
    processes, setProcesses, activeProcess, setActiveProcess
  } =  useContext(ProcessContext);
  
  const nodes = processes.map((p, i) => ({
    id: p.id,
    position: { x: 50, y: i * 100 },
    data: {
      label: (
        <div
          className="card p-2"
          style={{ cursor: "pointer", minWidth: 150 }}
          onClick={() => setActiveProcess(p)}
        >
          <strong>{p.name}</strong>
          <div className="text-muted small">
            {p.type} v{p.version}
          </div>
          <div>
            {p.state === "queued" && <span className="badge bg-warning">Queued</span>}
            {p.state === "running" && <span className="badge bg-primary">Running</span>}
            {p.state === "done" && <span className="badge bg-success">Done</span>}
          </div>
        </div>
      )
    }
  }));

  return (
    // ✅ Set explicit height here
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow nodes={nodes} edges={[]}>
        <Background />
      </ReactFlow>
    </div>
  );
}
