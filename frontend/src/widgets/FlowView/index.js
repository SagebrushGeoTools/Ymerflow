import React, { useContext, useState, useCallback, useMemo, useRef } from "react";
import ReactFlow, { Background, useNodesState, useEdgesState, Position } from "reactflow";
import 'reactflow/dist/style.css';
import { ProcessContext } from '../../ProcessContext';
import { useEffect } from "react";
import { useRegisterMenu } from "../../flexout/MenuContext";
import { LayoutContext } from "../../flexout/LayoutContext";
import ProcessNode from './ProcessNode';
import { getLatestVersion, getProcessVersion } from '../../datamodel/api';

export default function FlowView({}) {
  const {
    processes, setProcesses, activeProcess, setActiveProcess, currentProject
  } =  useContext(ProcessContext);
  const { findWidgetPaths, activatePath } = useContext(LayoutContext);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedVersions, setSelectedVersions] = useState({});

  // Track which processes have been initialized to avoid reinitializing
  const initializedProcessIds = useRef(new Set());
  // Track user-positioned nodes to preserve their positions
  const userPositionedNodes = useRef({});
  // Track last process structure to detect changes
  const lastProcessStructure = useRef(null);
  // ReactFlow instance for programmatic fitView
  const rfInstanceRef = useRef(null);
  // Track process count to detect when a new process is added vs. just dep/version updates
  const prevProcessCountRef = useRef(0);

  // Clear refs when project changes
  useEffect(() => {
    console.log('[FlowView] Project changed:', currentProject);
    console.log('[FlowView] Clearing refs, state, nodes, and edges');
    initializedProcessIds.current = new Set();
    userPositionedNodes.current = {};
    lastProcessStructure.current = null;
    prevProcessCountRef.current = 0;
    setSelectedVersions({});
    setNodes([]);
    setEdges([]);
  }, [currentProject, setNodes, setEdges]);

  // Register custom node types
  const nodeTypes = useMemo(() => ({ processNode: ProcessNode }), []);

  useRegisterMenu(["Process", "Create"], () => {
    setActiveProcess(null);
    const paths = findWidgetPaths('ProcessEditor');
    if (paths.length > 0) activatePath(paths[0]);
  });

  // Initialize selectedVersions only when NEW processes are added
  useEffect(() => {
    console.log('[FlowView] Processes changed:', processes.length, 'processes');
    console.log('[FlowView] Current selectedVersions:', Object.keys(selectedVersions).length);
    if (processes.length === 0) {
      console.log('[FlowView] No processes, skipping initialization');
      return;
    }

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
      const process = processes.find(p => p.id === processId);
      if (!process) return;

      const version = newSelectedVersions[processId];
      const versionObj = getProcessVersion(process, version);
      if (!versionObj) return;

      // Skip if already processed with the same version (avoid infinite loops)
      const processKey = `${processId}:${version}`;
      if (processed.has(processKey)) return;
      processed.add(processKey);

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

  // Use refs to avoid dependency cycles
  const processesRef = useRef(processes);
  const selectedVersionsRef = useRef(selectedVersions);

  useEffect(() => {
    processesRef.current = processes;
    selectedVersionsRef.current = selectedVersions;
  }, [processes, selectedVersions]);


  // Handle version change - stable callback using refs
  const handleVersionChange = useCallback((processId, newVersion) => {
    const newSelectedVersions = { ...selectedVersionsRef.current };
    const processed = new Set();

    const propagateVersions = (pid) => {
      const process = processesRef.current.find(p => p.id === pid);
      if (!process) return;

      const version = newSelectedVersions[pid];
      const versionObj = getProcessVersion(process, version);
      if (!versionObj) return;

      // Skip if already processed with the same version (avoid infinite loops)
      const processKey = `${pid}:${version}`;
      if (processed.has(processKey)) return;
      processed.add(processKey);

      // Propagate upstream
      if (versionObj.dependencies) {
        versionObj.dependencies.forEach(dep => {
          newSelectedVersions[dep.source_process_id] = dep.source_process_version;
          propagateVersions(dep.source_process_id);
        });
      }

      // Propagate downstream
      processesRef.current.forEach(p => {
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
  }, []); // No dependencies - uses refs

  // Calculate depth (layer) for each process based on selected versions
  // Stable function using refs to avoid dependency cycles
  const calculateDepths = useCallback(() => {
    const depths = {};
    const visited = new Set();

    // Build adjacency list based on selected versions
    const upstreamMap = {};
    processesRef.current.forEach(p => {
      upstreamMap[p.id] = [];
      const version = selectedVersionsRef.current[p.id];
      const versionObj = getProcessVersion(p, version);
      if (versionObj?.dependencies) {
        versionObj.dependencies.forEach(dep => {
          // Only include if the dependency version matches selected version
          if (selectedVersionsRef.current[dep.source_process_id] === dep.source_process_version) {
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

    processesRef.current.forEach(p => calculateDepth(p.id));
    return depths;
  }, []); // No dependencies - uses refs

  // Sync selectedVersions with activeProcess when the active version changes externally
  // (e.g., after ProcessEditor creates a new version)
  useEffect(() => {
    if (!activeProcess) return;
    if (selectedVersionsRef.current[activeProcess.processId] !== activeProcess.version) {
      handleVersionChange(activeProcess.processId, activeProcess.version);
    }
  }, [activeProcess, handleVersionChange]);

  // Memoized click handler for nodes
  const handleNodeClick = useCallback((processId, version) => {
    setActiveProcess({ processId, version });
  }, [setActiveProcess]);

  // Detect if process structure has changed (not just state)
  const getProcessStructure = useCallback(() => {
    return JSON.stringify(processes.map(p => ({
      id: p.id,
      versions: p.versions?.map(v => ({
        version: v.version,
        dependencies: v.dependencies
      }))
    })));
  }, [processes]);

  // Track node position changes from user dragging
  const handleNodesChangeWithTracking = useCallback((changes) => {
    changes.forEach(change => {
      if (change.type === 'position' && change.dragging === false && change.position) {
        // User finished dragging - save the position
        userPositionedNodes.current[change.id] = change.position;
      }
    });
    onNodesChange(changes);
  }, [onNodesChange]);

  // Update nodes and edges when process structure or selectedVersions change
  useEffect(() => {
    if (Object.keys(selectedVersions).length === 0) return;
    // Don't render edges until all processes have selected versions
    if (processes.length !== Object.keys(selectedVersions).length) return;

    const currentStructure = getProcessStructure();
    const structureChanged = currentStructure !== lastProcessStructure.current;

    if (structureChanged) {
      lastProcessStructure.current = currentStructure;
    }

    // Only reset layout and fit view when a new process node is actually added.
    // Dep resolution or new versions on existing processes should NOT jump the viewport
    // or discard user-positioned node locations.
    const newProcessAdded = processes.length > prevProcessCountRef.current;
    prevProcessCountRef.current = processes.length;

    if (newProcessAdded) {
      // New process: reset auto-layout so the new node gets a fresh calculated position
      userPositionedNodes.current = {};
    }

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

      // Use user position if available, otherwise calculate
      const position = userPositionedNodes.current[p.id] || {
        x: depth * horizontalSpacing + 50,
        y: indexInLayer * verticalSpacing + 50
      };

      return {
        id: p.id,
        type: 'processNode',
        position,
        data: {
          process: p,
          selectedVersion: selectedVersions[p.id],
          onVersionChange: handleVersionChange,
          onClick: handleNodeClick,
          activeProcess
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
              animated: false,
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

    // Re-fit the view only when a new process node is added, so the user can see it.
    // Do NOT refit on dep/version updates — that would jump the viewport unexpectedly.
    if (newProcessAdded && rfInstanceRef.current) {
      setTimeout(() => rfInstanceRef.current?.fitView({ padding: 0.2, duration: 300 }), 50);
    }
  }, [processes, selectedVersions, calculateDepths, handleVersionChange, handleNodeClick, activeProcess, setNodes, setEdges, getProcessStructure]);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChangeWithTracking}
        onEdgesChange={onEdgesChange}
        onInit={(instance) => { rfInstanceRef.current = instance; }}
        fitView
      >
        <Background />
      </ReactFlow>
    </div>
  );
}

FlowView.title = "Processes overview";
