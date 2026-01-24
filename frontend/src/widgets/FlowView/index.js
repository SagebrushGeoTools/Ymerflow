import React, { useContext, useState, useCallback, useMemo, useRef } from "react";
import ReactFlow, { Background, useNodesState, useEdgesState, Position } from "reactflow";
import 'reactflow/dist/style.css';
import { ProcessContext } from '../../ProcessContext';
import { useEffect } from "react";
import { useRegisterMenu } from "../../flexout/MenuContext";
import ProcessNode from './ProcessNode';
import { getLatestVersion, getProcessVersion } from '../../api';

export default function FlowView({}) {
  const {
    processes, setProcesses, activeProcess, setActiveProcess
  } =  useContext(ProcessContext);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedVersions, setSelectedVersions] = useState({});

  // Track which processes have been initialized to avoid reinitializing
  const initializedProcessIds = useRef(new Set());

  // Register custom node types
  const nodeTypes = useMemo(() => ({ processNode: ProcessNode }), []);

  useRegisterMenu(["Process", "Create"], () => setActiveProcess(null));

  // Initialize selectedVersions only when NEW processes are added
  useEffect(() => {
    if (processes.length === 0) return;

    const currentProcessIds = new Set(processes.map(p => p.id));
    const newProcessIds = [...currentProcessIds].filter(id => !initializedProcessIds.current.has(id));

    // If no new processes and we already have selections, keep them stable
    if (newProcessIds.length === 0 && Object.keys(selectedVersions).length > 0) {
      return;
    }

    // If this is the very first initialization or we have new processes
    const newSelectedVersions = { ...selectedVersions };
    const processed = new Set();

    // Recursive function to set versions based on dependencies
    const propagateVersions = (processId) => {
      if (processed.has(processId)) return;
      processed.add(processId);

      const process = processes.find(p => p.id === processId);
      if (!process) return;

      const version = newSelectedVersions[processId];
      const versionObj = getProcessVersion(process, version);
      if (!versionObj) return;

      // Propagate upstream (dependencies)
      if (versionObj.dependencies) {
        versionObj.dependencies.forEach(dep => {
          newSelectedVersions[dep.source_process_id] = dep.source_process_version;
          propagateVersions(dep.source_process_id);
        });
      }

      // Propagate downstream (dependents)
      processes.forEach(p => {
        p.versions?.forEach(v => {
          if (v.dependencies) {
            v.dependencies.forEach(dep => {
              if (dep.source_process_id === processId && dep.source_process_version === version) {
                newSelectedVersions[p.id] = v.version;
                propagateVersions(p.id);
              }
            });
          }
        });
      });
    };

    // For new processes, initialize them
    if (newProcessIds.length > 0) {
      // Initialize new processes
      newProcessIds.forEach(newId => {
        const process = processes.find(p => p.id === newId);
        if (process) {
          newSelectedVersions[newId] = getLatestVersion(process);
          propagateVersions(newId);
        }
      });
    } else {
      // First time initialization - start with first process
      const startProcess = processes[0];
      if (startProcess) {
        newSelectedVersions[startProcess.id] = getLatestVersion(startProcess);
        propagateVersions(startProcess.id);
      }
    }

    // Process any remaining unprocessed nodes
    processes.forEach(p => {
      if (!processed.has(p.id)) {
        newSelectedVersions[p.id] = getLatestVersion(p);
        propagateVersions(p.id);
      }
    });

    // Mark all current processes as initialized
    processes.forEach(p => initializedProcessIds.current.add(p.id));

    setSelectedVersions(newSelectedVersions);
  }, [processes]);

  // Handle version change
  const handleVersionChange = useCallback((processId, newVersion) => {
    const newSelectedVersions = { ...selectedVersions };
    const processed = new Set();

    const propagateVersions = (pid) => {
      if (processed.has(pid)) return;
      processed.add(pid);

      const process = processes.find(p => p.id === pid);
      if (!process) return;

      const version = newSelectedVersions[pid];
      const versionObj = getProcessVersion(process, version);
      if (!versionObj) return;

      // Propagate upstream
      if (versionObj.dependencies) {
        versionObj.dependencies.forEach(dep => {
          newSelectedVersions[dep.source_process_id] = dep.source_process_version;
          propagateVersions(dep.source_process_id);
        });
      }

      // Propagate downstream
      processes.forEach(p => {
        p.versions?.forEach(v => {
          if (v.dependencies) {
            v.dependencies.forEach(dep => {
              if (dep.source_process_id === pid && dep.source_process_version === version) {
                newSelectedVersions[p.id] = v.version;
                propagateVersions(p.id);
              }
            });
          }
        });
      });
    };

    newSelectedVersions[processId] = newVersion;
    propagateVersions(processId);
    setSelectedVersions(newSelectedVersions);
  }, [selectedVersions, processes]);

  // Calculate depth (layer) for each process based on selected versions
  const calculateDepths = useCallback(() => {
    const depths = {};
    const visited = new Set();

    // Build adjacency list based on selected versions
    const upstreamMap = {};
    processes.forEach(p => {
      upstreamMap[p.id] = [];
      const version = selectedVersions[p.id];
      const versionObj = getProcessVersion(p, version);
      if (versionObj?.dependencies) {
        versionObj.dependencies.forEach(dep => {
          // Only include if the dependency version matches selected version
          if (selectedVersions[dep.source_process_id] === dep.source_process_version) {
            upstreamMap[p.id].push(dep.source_process_id);
          }
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
  }, [processes, selectedVersions]);

  // Update nodes and edges when processes or selectedVersions change
  useEffect(() => {
    if (Object.keys(selectedVersions).length === 0) return;

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

    const newNodes = processes.map((p) => {
      const depth = depths[p.id] || 0;
      const layer = layerMap[depth];
      const indexInLayer = layer.indexOf(p);

      return {
        id: p.id,
        type: 'processNode',
        position: {
          x: depth * horizontalSpacing + 50,
          y: indexInLayer * verticalSpacing + 50
        },
        data: {
          process: p,
          selectedVersion: selectedVersions[p.id],
          onVersionChange: handleVersionChange,
          onClick: () => setActiveProcess({ processId: p.id, version: selectedVersions[p.id] })
        }
      };
    });

    // Build edges based on selected versions
    const newEdges = [];
    processes.forEach((p) => {
      const version = selectedVersions[p.id];
      const versionObj = getProcessVersion(p, version);

      if (versionObj?.dependencies && Array.isArray(versionObj.dependencies)) {
        versionObj.dependencies.forEach((dep, idx) => {
          // Only show edge if the source version matches selected version
          if (selectedVersions[dep.source_process_id] === dep.source_process_version) {
            newEdges.push({
              id: `${dep.source_process_id}-${p.id}-${idx}`,
              source: dep.source_process_id,
              sourceHandle: dep.source_dataset_name,
              target: p.id,
              targetHandle: dep.target_param_name,
              label: `${dep.source_dataset_name} → ${dep.target_param_name}`,
              type: 'default',
              animated: true,
              style: { stroke: '#555' },
              labelStyle: { fill: '#555', fontSize: 12 },
              labelBgStyle: { fill: '#fff' }
            });
          }
        });
      }
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [processes, selectedVersions, calculateDepths, handleVersionChange, setNodes, setEdges, setActiveProcess]);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
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
