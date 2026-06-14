import React, { useContext, useState, useCallback, useMemo, useRef } from "react";
import ReactFlow, { Background, useNodesState, useEdgesState, Position } from "reactflow";
import 'reactflow/dist/style.css';
import { ProcessContext } from '../../ProcessContext';
import { useEffect } from "react";
import { useRegisterMenu } from "../../flexout/MenuContext";
import { LayoutContext } from "../../flexout/LayoutContext";
import ProcessNode from './ProcessNode';
import TagFilterBar from './TagFilterBar';
import { getLatestVersion, getProcessVersion } from '../../datamodel/api';
import { useProjectTags } from '../../datamodel/useQueries';

export default function FlowView({}) {
  const {
    processes, setProcesses, activeProcess, setActiveProcess, currentProject, isLoading
  } =  useContext(ProcessContext);
  const { findWidgetPaths, activatePath } = useContext(LayoutContext);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedVersions, setSelectedVersions] = useState({});
  const [selectedFilterTagIds, setSelectedFilterTagIds] = useState(new Set());

  const { data: projectTags = [] } = useProjectTags(currentProject);

  const initializedProcessIds = useRef(new Set());
  const userPositionedNodes = useRef({});
  const lastProcessStructure = useRef(null);
  const rfInstanceRef = useRef(null);
  const prevProcessCountRef = useRef(0);

  useEffect(() => {
    initializedProcessIds.current = new Set();
    userPositionedNodes.current = {};
    lastProcessStructure.current = null;
    prevProcessCountRef.current = 0;
    setNodes([]);
    setEdges([]);
    setSelectedFilterTagIds(new Set());
  }, [currentProject, setNodes, setEdges]);

  const nodeTypes = useMemo(() => ({ processNode: ProcessNode }), []);

  useRegisterMenu(["Process", "Create"], () => {
    setActiveProcess(null);
    const paths = findWidgetPaths('ProcessEditor');
    if (paths.length > 0) activatePath(paths[0]);
  });

  useEffect(() => {
    const isFreshStart = initializedProcessIds.current.size === 0;

    if (processes.length === 0) {
      if (isFreshStart) {
        setSelectedVersions({});
      }
      return;
    }

    const currentProcessIds = new Set(processes.map(p => p.id));
    const newProcessIds = [...currentProcessIds].filter(id => !initializedProcessIds.current.has(id));

    if (newProcessIds.length === 0 && processes.every(p => selectedVersions[p.id] !== undefined)) {
      return;
    }

    const newSelectedVersions = isFreshStart ? {} : { ...selectedVersions };
    const processed = new Set();

    const propagateVersions = (processId) => {
      const process = processes.find(p => p.id === processId);
      if (!process) return;

      const version = newSelectedVersions[processId];
      const versionObj = getProcessVersion(process, version);
      if (!versionObj) return;

      const processKey = `${processId}:${version}`;
      if (processed.has(processKey)) return;
      processed.add(processKey);

      if (versionObj.dependencies) {
        versionObj.dependencies.forEach(dep => {
          newSelectedVersions[dep.source_process_id] = dep.source_process_version;
          propagateVersions(dep.source_process_id);
        });
      }

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

    if (newProcessIds.length > 0) {
      newProcessIds.forEach(newId => {
        const process = processes.find(p => p.id === newId);
        if (process) {
          newSelectedVersions[newId] = getLatestVersion(process);
          propagateVersions(newId);
        }
      });
    } else {
      const startProcess = processes[0];
      if (startProcess) {
        newSelectedVersions[startProcess.id] = getLatestVersion(startProcess);
        propagateVersions(startProcess.id);
      }
    }

    processes.forEach(p => {
      if (!processed.has(p.id)) {
        newSelectedVersions[p.id] = getLatestVersion(p);
        propagateVersions(p.id);
      }
    });

    processes.forEach(p => initializedProcessIds.current.add(p.id));

    setSelectedVersions(newSelectedVersions);
  }, [currentProject, processes]); // eslint-disable-line react-hooks/exhaustive-deps

  const processesRef = useRef(processes);
  const selectedVersionsRef = useRef(selectedVersions);

  useEffect(() => {
    processesRef.current = processes;
    selectedVersionsRef.current = selectedVersions;
  }, [processes, selectedVersions]);

  const handleVersionChange = useCallback((processId, newVersion) => {
    const newSelectedVersions = { ...selectedVersionsRef.current };
    const processed = new Set();

    const propagateVersions = (pid) => {
      const process = processesRef.current.find(p => p.id === pid);
      if (!process) return;

      const version = newSelectedVersions[pid];
      const versionObj = getProcessVersion(process, version);
      if (!versionObj) return;

      const processKey = `${pid}:${version}`;
      if (processed.has(processKey)) return;
      processed.add(processKey);

      if (versionObj.dependencies) {
        versionObj.dependencies.forEach(dep => {
          newSelectedVersions[dep.source_process_id] = dep.source_process_version;
          propagateVersions(dep.source_process_id);
        });
      }

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
  }, []);

  const calculateDepths = useCallback(() => {
    const depths = {};
    const visited = new Set();

    const upstreamMap = {};
    processesRef.current.forEach(p => {
      upstreamMap[p.id] = [];
      const version = selectedVersionsRef.current[p.id];
      const versionObj = getProcessVersion(p, version);
      if (versionObj?.dependencies) {
        versionObj.dependencies.forEach(dep => {
          if (selectedVersionsRef.current[dep.source_process_id] === dep.source_process_version) {
            upstreamMap[p.id].push(dep.source_process_id);
          }
        });
      }
    });

    const calculateDepth = (processId) => {
      if (depths[processId] !== undefined) return depths[processId];
      if (visited.has(processId)) return 0;

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
  }, []);

  useEffect(() => {
    if (!activeProcess) return;
    if (selectedVersionsRef.current[activeProcess.processId] !== activeProcess.version) {
      handleVersionChange(activeProcess.processId, activeProcess.version);
    }
  }, [activeProcess, handleVersionChange]);

  const handleNodeClick = useCallback((processId, version) => {
    setActiveProcess({ processId, version });
  }, [setActiveProcess]);

  const getProcessStructure = useCallback(() => {
    return JSON.stringify(processes.map(p => ({
      id: p.id,
      versions: p.versions?.map(v => ({
        version: v.version,
        dependencies: v.dependencies
      }))
    })));
  }, [processes]);

  const handleNodesChangeWithTracking = useCallback((changes) => {
    changes.forEach(change => {
      if (change.type === 'position' && change.dragging === false && change.position) {
        userPositionedNodes.current[change.id] = change.position;
      }
    });
    onNodesChange(changes);
  }, [onNodesChange]);

  // Compute visible processes based on active tag filter
  const visibleProcessIds = useMemo(() => {
    if (selectedFilterTagIds.size === 0) return null; // null = show all

    // Only the selected version per process is considered for tag matching
    const taggedVersions = new Map(); // processId → Set<versionNumber>
    processes.forEach(process => {
      const selVer = selectedVersions[process.id];
      const v = process.versions?.find(ver => ver.version === selVer);
      if (!v) return;
      const vTagIds = new Set((v.tags || []).map(t => t.id));
      const hasAll = [...selectedFilterTagIds].every(id => vTagIds.has(id));
      if (hasAll) {
        taggedVersions.set(process.id, new Set([v.version]));
      }
    });

    // BFS to collect transitive dependencies
    const transitiveDeps = new Map(); // processId → Set<versionNumber>
    const processById = new Map(processes.map(p => [p.id, p]));
    const visited = new Set();
    const queue = [];
    taggedVersions.forEach((versions, pid) => versions.forEach(v => queue.push({ pid, v })));

    while (queue.length > 0) {
      const { pid, v } = queue.shift();
      const key = `${pid}:${v}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const proc = processById.get(pid);
      const verObj = proc?.versions?.find(ver => ver.version === v);
      verObj?.dependencies?.forEach(dep => {
        const depKey = `${dep.source_process_id}:${dep.source_process_version}`;
        if (!visited.has(depKey)) {
          if (!transitiveDeps.has(dep.source_process_id)) transitiveDeps.set(dep.source_process_id, new Set());
          transitiveDeps.get(dep.source_process_id).add(dep.source_process_version);
          queue.push({ pid: dep.source_process_id, v: dep.source_process_version });
        }
      });
    }

    const result = new Set();
    taggedVersions.forEach((_, pid) => result.add(pid));
    transitiveDeps.forEach((_, pid) => result.add(pid));
    return result;
  }, [processes, selectedVersions, selectedFilterTagIds]);

  useEffect(() => {
    if (Object.keys(selectedVersions).length === 0) return;
    if (processes.length !== Object.keys(selectedVersions).length) return;

    const currentStructure = getProcessStructure();
    const structureChanged = currentStructure !== lastProcessStructure.current;

    if (structureChanged) {
      lastProcessStructure.current = currentStructure;
    }

    const newProcessAdded = processes.length > prevProcessCountRef.current;
    prevProcessCountRef.current = processes.length;

    if (newProcessAdded) {
      userPositionedNodes.current = {};
    }

    const depths = calculateDepths();

    const layerMap = {};
    processes.forEach(p => {
      const depth = depths[p.id] || 0;
      if (!layerMap[depth]) layerMap[depth] = [];
      layerMap[depth].push(p);
    });

    const horizontalSpacing = 300;
    const verticalSpacing = 150;

    const newNodes = processes.map((p) => {
      const depth = depths[p.id] || 0;
      const layer = layerMap[depth];
      const indexInLayer = layer.indexOf(p);

      const position = userPositionedNodes.current[p.id] || {
        x: depth * horizontalSpacing + 50,
        y: indexInLayer * verticalSpacing + 50
      };

      return {
        id: p.id,
        type: 'processNode',
        position,
        hidden: visibleProcessIds !== null && !visibleProcessIds.has(p.id),
        data: {
          process: p,
          selectedVersion: selectedVersions[p.id],
          onVersionChange: handleVersionChange,
          onClick: handleNodeClick,
          activeProcess
        }
      };
    });

    const newEdges = [];
    processes.forEach((p) => {
      const version = selectedVersions[p.id];
      const versionObj = getProcessVersion(p, version);

      if (versionObj?.dependencies && Array.isArray(versionObj.dependencies)) {
        versionObj.dependencies.forEach((dep, idx) => {
          if (selectedVersions[dep.source_process_id] === dep.source_process_version) {
            const hidden = visibleProcessIds !== null && (
              !visibleProcessIds.has(dep.source_process_id) || !visibleProcessIds.has(p.id)
            );
            newEdges.push({
              id: `${dep.source_process_id}-${p.id}-${idx}`,
              source: dep.source_process_id,
              sourceHandle: dep.source_dataset_name,
              target: p.id,
              targetHandle: dep.target_param_name,
              label: `${dep.source_dataset_name} → ${dep.target_param_name}`,
              type: 'default',
              animated: false,
              hidden,
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

    if (newProcessAdded && rfInstanceRef.current) {
      setTimeout(() => rfInstanceRef.current?.fitView({ padding: 0.2, duration: 300 }), 50);
    }
  }, [processes, visibleProcessIds, selectedVersions, calculateDepths, handleVersionChange, handleNodeClick, activeProcess, setNodes, setEdges, getProcessStructure]);

  const handleToggleFilterTag = useCallback((tagId) => {
    setSelectedFilterTagIds(prev => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", display: "flex", flexDirection: "column" }}>
      <TagFilterBar
        projectTags={projectTags}
        selectedTagIds={selectedFilterTagIds}
        onToggle={handleToggleFilterTag}
      />
      <div style={{ flex: 1, position: "relative" }}>
        {isLoading && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            alignItems: "center", justifyContent: "center",
            background: "rgba(255,255,255,0.7)", zIndex: 10, pointerEvents: "none"
          }}>
            Loading processes…
          </div>
        )}
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
    </div>
  );
}

FlowView.title = "Processes overview";
