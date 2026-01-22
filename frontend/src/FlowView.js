import React, { useContext, useState, useCallback } from "react";
import ReactFlow, { Background, useNodesState, useEdgesState, Position } from "reactflow";
import 'reactflow/dist/style.css';
import { ProcessContext } from './ProcessContext';
import { useEffect } from "react";
import { useRegisterMenu } from "./flexout/MenuContext";

export default function FlowView({}) {
  const {
    processes, setProcesses, activeProcess, setActiveProcess
  } =  useContext(ProcessContext);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useRegisterMenu(["Process", "Create"], () => setActiveProcess(null));

  // Calculate depth (layer) for each process in the DAG
  const calculateDepths = () => {
    const depths = {};
    const visited = new Set();

    // Build adjacency list (reversed - from consumer to producer)
    const upstreamMap = {};
    processes.forEach(p => {
      upstreamMap[p.id] = [];
      if (p.dependencies) {
        p.dependencies.forEach(dep => {
          upstreamMap[p.id].push(dep.source_process_id);
        });
      }
    });

    // Calculate depth via DFS
    const calculateDepth = (processId) => {
      if (depths[processId] !== undefined) return depths[processId];
      if (visited.has(processId)) return 0; // Cycle detection

      visited.add(processId);

      const upstream = upstreamMap[processId] || [];
      if (upstream.length === 0) {
        depths[processId] = 0;
      } else {
        const maxUpstreamDepth = Math.max(...upstream.map(id => calculateDepth(id)));
        depths[processId] = maxUpstreamDepth + 1;
      }

      return depths[processId];
    };

    processes.forEach(p => calculateDepth(p.id));
    return depths;
  };

  const depths = calculateDepths();

  // Group processes by depth
  const layerMap = {};
  processes.forEach(p => {
    const depth = depths[p.id] || 0;
    if (!layerMap[depth]) layerMap[depth] = [];
    layerMap[depth].push(p);
  });

  // Layout parameters
  const horizontalSpacing = 300;
  const verticalSpacing = 150;

  // Update nodes and edges when processes change
  useEffect(() => {
    const newNodes = processes.map((p) => {
      const depth = depths[p.id] || 0;
      const layer = layerMap[depth];
      const indexInLayer = layer.indexOf(p);

      return {
        id: p.id,
        position: {
          x: depth * horizontalSpacing + 50,
          y: indexInLayer * verticalSpacing + 50
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
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
      };
    });

    // Build edges from dependencies
    const newEdges = [];
    processes.forEach((p) => {
      if (p.dependencies && Array.isArray(p.dependencies)) {
        p.dependencies.forEach((dep, idx) => {
          newEdges.push({
            id: `${dep.source_process_id}-${p.id}-${idx}`,
            source: dep.source_process_id,
            target: p.id,
            label: `${dep.source_dataset_name} → ${dep.target_param_name}`,
            type: 'default',
            animated: true,
            style: { stroke: '#555' },
            labelStyle: { fill: '#555', fontSize: 12 },
            labelBgStyle: { fill: '#fff' }
          });
        });
      }
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [processes, setNodes, setEdges]);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
      >
        <Background />
      </ReactFlow>
    </div>
  );
}

FlowView.title = "Processes overview";
