import React, { createContext, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useProcesses, useEnvironments, useProcessOutputDatasets, useProjects } from "./datamodel/useQueries";

export const ProcessContext = createContext();

// Helper to parse URL pathname into params
// Expected format: /w/:workspace/p/:project/pr/:process/v/:version/part/:part/s/:sounding
// All segments are optional
function parseUrlParams(pathname) {
  const params = {
    workspace: null,
    project: null,
    process: null,
    version: null,
    part: null,
    sounding: null
  };

  // Remove leading slash and split by /
  const segments = pathname.replace(/^\//, '').split('/');

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === 'w' && i + 1 < segments.length) {
      params.workspace = segments[i + 1];
      i++;
    } else if (segment === 'p' && i + 1 < segments.length) {
      params.project = segments[i + 1];
      i++;
    } else if (segment === 'pr' && i + 1 < segments.length) {
      params.process = segments[i + 1];
      i++;
    } else if (segment === 'v' && i + 1 < segments.length) {
      params.version = parseInt(segments[i + 1], 10);
      i++;
    } else if (segment === 'part' && i + 1 < segments.length) {
      params.part = segments[i + 1];
      i++;
    } else if (segment === 's' && i + 1 < segments.length) {
      params.sounding = parseInt(segments[i + 1], 10);
      i++;
    }
  }

  return params;
}

// Helper to build URL path from params
function buildUrlPath(workspace, project, process, version, part, sounding) {
  let path = '';

  if (workspace) {
    path += `/w/${workspace}`;
    if (project) {
      path += `/p/${project}`;
      if (process) {
        path += `/pr/${process}`;
        if (version !== null && version !== undefined) {
          path += `/v/${version}`;
          if (part) {
            path += `/part/${part}`;
          }
          if (sounding !== null && sounding !== undefined) {
            path += `/s/${sounding}`;
          }
        }
      }
    }
  }

  return path || '/';
}

export const ProcessProvider = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Parse current values from URL
  const urlParams = useMemo(() => parseUrlParams(location.pathname), [location.pathname]);

  // Extract values from URL
  const selectedEnvironment = urlParams.workspace;
  const currentProject = urlParams.project;
  const activeProcess = urlParams.process ? { processId: urlParams.process, version: urlParams.version } : null;
  const currentPart = urlParams.part || "all";
  const currentSounding = urlParams.sounding !== null ? urlParams.sounding : 0;

  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: processes = [], isLoading, error, refetch } = useProcesses(currentProject);
  const { data: environments = [], isLoading: environmentsLoading } = useEnvironments();

  // Setter functions that update the URL
  const setSelectedEnvironment = useCallback((workspace) => {
    const path = buildUrlPath(workspace, currentProject, activeProcess?.processId, activeProcess?.version, currentPart === "all" ? null : currentPart, currentSounding);
    navigate(path);
  }, [navigate, currentProject, activeProcess, currentPart, currentSounding]);

  const setCurrentProject = useCallback((project) => {
    const path = buildUrlPath(selectedEnvironment, project, activeProcess?.processId, activeProcess?.version, currentPart === "all" ? null : currentPart, currentSounding);
    navigate(path);
  }, [navigate, selectedEnvironment, activeProcess, currentPart, currentSounding]);

  const setActiveProcess = useCallback((process) => {
    const path = buildUrlPath(selectedEnvironment, currentProject, process?.processId, process?.version, currentPart === "all" ? null : currentPart, currentSounding);
    navigate(path);
  }, [navigate, selectedEnvironment, currentProject, currentPart, currentSounding]);

  const setCurrentPart = useCallback((part) => {
    const path = buildUrlPath(selectedEnvironment, currentProject, activeProcess?.processId, activeProcess?.version, part === "all" ? null : part, currentSounding);
    navigate(path);
  }, [navigate, selectedEnvironment, currentProject, activeProcess, currentSounding]);

  const setCurrentSounding = useCallback((sounding) => {
    const path = buildUrlPath(selectedEnvironment, currentProject, activeProcess?.processId, activeProcess?.version, currentPart === "all" ? null : currentPart, sounding);
    navigate(path);
  }, [navigate, selectedEnvironment, currentProject, activeProcess, currentPart]);

  // WebSocket for process state updates
  React.useEffect(() => {
    console.log('Setting up process state WebSocket...');
    const ws = new WebSocket('ws://localhost:8000/ws/processes/updates');

    ws.onopen = () => {
      console.log('✓ Connected to process state updates WebSocket');
    };

    ws.onmessage = (event) => {
      const update = JSON.parse(event.data);
      console.log('📡 Process state update received:', update);

      // Refetch processes to get updated state
      refetch();
    };

    ws.onerror = (error) => {
      console.error('❌ WebSocket error:', error);
    };

    ws.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason);
    };

    return () => {
      console.log('Closing WebSocket connection');
      ws.close();
    };
  }, []); // Empty dependency array - only connect once

  // Find the actual process object from activeProcess
  const process = activeProcess ? processes.find(p => p.id === activeProcess.processId) : null;
  const version = activeProcess?.version;

  const { data: datasets = [] } = useProcessOutputDatasets(process, version);

  // Auto-select first project if none selected
  React.useEffect(() => {
    if (!currentProject && projects.length > 0) {
      setCurrentProject(projects[0].id);
    }
  }, [projects, currentProject, setCurrentProject]);

  // Auto-select latest environment if none selected
  React.useEffect(() => {
    if (!selectedEnvironment && environments.length > 0) {
      // Select the last environment (most recently created)
      const latestEnv = environments[environments.length - 1];
      setSelectedEnvironment(latestEnv.id);
    }
  }, [environments, selectedEnvironment, setSelectedEnvironment]);

  return (
    <ProcessContext.Provider
      value={{
        projects,
        projectsLoading,
        currentProject,
        setCurrentProject,
        processes,
        isLoading,
        error,
        refetchProcesses: refetch,
        activeProcess,
        setActiveProcess,
        currentPart,
        setCurrentPart,
        selectedEnvironment,
        setSelectedEnvironment,
        environments,
        environmentsLoading,
        datasets,
        currentSounding,
        setCurrentSounding
      }}>
      {children}
    </ProcessContext.Provider>
  );
};
