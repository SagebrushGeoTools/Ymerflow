import React, { createContext, useCallback, useMemo, useState, useEffect, useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useProcesses, useEnvironments, useProcessOutputDatasets, useProjects } from "./datamodel/useQueries";
import { loadDataset, DatasetCollectionAdapter } from './datamodel/dataset';
import { useWebSocket } from './hooks/useWebSocket';
import { WS_API } from './datamodel/api';
import { MessageContext } from './MessageContext';

export const ProcessContext = createContext();

// Moved outside component to avoid recreation
const INITIAL_DATASET_OBJECTS = {};
const INITIAL_FETCHED_DATA = {};
const EMPTY_ARRAY = [];

// Helper to parse URL pathname into params
// Expected format: /app/w/:workspace/p/:project/pr/:process/v/:version/part/:part/s/:sounding
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

  // Strip /app prefix if present, then remove leading slash and split by /
  const cleanPath = pathname.replace(/^\/app/, '').replace(/^\//, '');
  const segments = cleanPath.split('/');

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
  let path = '/app';

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

  return path;
}

export function ProcessProvider({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { addMessage } = useContext(MessageContext);

  // Parse current values from URL
  const urlParams = useMemo(() => parseUrlParams(location.pathname), [location.pathname]);

  // Extract values from URL - memoize objects to prevent unnecessary re-renders
  const selectedEnvironment = urlParams.workspace;
  const currentProject = urlParams.project;
  const activeProcess = useMemo(() =>
    urlParams.process ? { processId: urlParams.process, version: urlParams.version } : null,
    [urlParams.process, urlParams.version]
  );
  const currentPart = urlParams.part || "all";
  const currentSounding = urlParams.sounding !== null ? urlParams.sounding : 0;

  const { data: projects = EMPTY_ARRAY, isLoading: projectsLoading, error: projectsError } = useProjects();
  const { data: processes = EMPTY_ARRAY, isLoading, error: processesError, refetch } = useProcesses(currentProject);
  const { data: environments = EMPTY_ARRAY, isLoading: environmentsLoading, error: environmentsError } = useEnvironments();

  // Handle query errors
  useEffect(() => {
    if (projectsError) {
      const status = projectsError.response?.status;
      const message = status
        ? `Failed to load projects (HTTP ${status})`
        : `Failed to load projects: ${projectsError.message || 'Unknown error'}`;
      addMessage({ level: 'danger', message });
    }
  }, [projectsError, addMessage]);

  useEffect(() => {
    if (processesError) {
      const status = processesError.response?.status;
      const message = status
        ? `Failed to load processes (HTTP ${status})`
        : `Failed to load processes: ${processesError.message || 'Unknown error'}`;
      addMessage({ level: 'danger', message });
    }
  }, [processesError, addMessage]);

  useEffect(() => {
    if (environmentsError) {
      const status = environmentsError.response?.status;
      const message = status
        ? `Failed to load environments (HTTP ${status})`
        : `Failed to load environments: ${environmentsError.message || 'Unknown error'}`;
      addMessage({ level: 'danger', message });
    }
  }, [environmentsError, addMessage]);

  useEffect(() => {
    const proj = projects.find(p => p.id === currentProject);
    if (proj && proj.storage_status === 'failed') {
      addMessage({ level: 'danger', message: `Storage setup failed for project "${proj.name}". Jobs cannot run until storage is provisioned. Retry via POST /projects/${proj.id}/setup-storage.` });
    }
  }, [currentProject, projects, addMessage]);

  // Setter functions that update the URL
  const setSelectedEnvironment = useCallback((workspace) => {
    const path = buildUrlPath(workspace, currentProject, activeProcess?.processId, activeProcess?.version, currentPart === "all" ? null : currentPart, currentSounding);
    navigate(path);
  }, [navigate, currentProject, activeProcess, currentPart, currentSounding]);

  const setCurrentProject = useCallback((project) => {
    const path = buildUrlPath(selectedEnvironment, project, null, null, null, null);
    navigate(path);
  }, [navigate, selectedEnvironment]);

  const setActiveProcess = useCallback((process) => {
    const path = buildUrlPath(selectedEnvironment, currentProject, process?.processId, process?.version, null, null);
    navigate(path);
  }, [navigate, selectedEnvironment, currentProject]);

  const setCurrentPart = useCallback((part) => {
    const path = buildUrlPath(selectedEnvironment, currentProject, activeProcess?.processId, activeProcess?.version, part === "all" ? null : part, null);
    navigate(path);
  }, [navigate, selectedEnvironment, currentProject, activeProcess]);

  const setCurrentSounding = useCallback((sounding) => {
    const path = buildUrlPath(selectedEnvironment, currentProject, activeProcess?.processId, activeProcess?.version, currentPart === "all" ? null : currentPart, sounding);
    navigate(path);
  }, [navigate, selectedEnvironment, currentProject, activeProcess, currentPart]);

  // Centralized cache invalidation helpers - THE ONLY WAY to invalidate queries in the app
  const invalidateHelpers = useMemo(() => ({
    // Invalidate a specific process and all its related data
    invalidateProcess: async (processId, projectId = currentProject) => {
      await Promise.all([
        queryClient.refetchQueries({
          queryKey: ['processes', projectId],
          type: 'active'
        }),
        queryClient.refetchQueries({
          queryKey: ['processOutputDatasets', processId],
          type: 'active'
        })
      ]);
    },

    // Invalidate all processes and related data for current project (or specified project)
    invalidateProject: async (projectId = currentProject) => {
      // Refetch processes - processOutputDatasets will auto-refetch when state changes (due to query key)
      await Promise.all([
        queryClient.refetchQueries({
          queryKey: ['processes', projectId],
          type: 'active'
        }),
        queryClient.refetchQueries({
          queryKey: ['datasets'],
          type: 'active'
        })
      ]);
    },

    // Invalidate datasets only
    invalidateDatasets: async () => {
      await queryClient.refetchQueries({
        queryKey: ['datasets'],
        type: 'active'
      });
    }
  }), [queryClient, currentProject]);

  // Stable WebSocket callbacks wrapped in useCallback to prevent reconnection loops
  const handleWebSocketMessage = useCallback(async (update) => {
    // Use centralized invalidation helper - this is the ONLY place WebSocket updates trigger refetches
    await invalidateHelpers.invalidateProject();
  }, [invalidateHelpers]);

  // WebSocket for process state updates with auto-reconnect
  useWebSocket(`${WS_API}/ws/processes/updates`, {
    enabled: !!currentProject,
    name: 'Process State Updates',
    onMessage: handleWebSocketMessage
  });

  // Find the actual process object from activeProcess
  const process = activeProcess ? processes.find(p => p.id === activeProcess.processId) : null;
  const version = activeProcess?.version;

  const { data: datasets = EMPTY_ARRAY, isLoading: datasetsQueryLoading } = useProcessOutputDatasets(process, version);

  // State for dataset objects and data - use stable initial values
  const [datasetObjects, setDatasetObjects] = useState(INITIAL_DATASET_OBJECTS);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [fetchedData, setFetchedData] = useState(INITIAL_FETCHED_DATA);
  const [dataLoading, setDataLoading] = useState(false);

  // Load dataset objects when datasets change
  useEffect(() => {
    const loadDatasets = async () => {
      setDatasetsLoading(true);
      const newDatasetObjects = {};

      for (const dataset of datasets) {
        try {
          const datasetObj = await loadDataset(dataset.id);
          newDatasetObjects[dataset.dataset_name] = datasetObj;
        } catch (error) {
          console.error(`Failed to load dataset ${dataset.dataset_name}:`, error);
          const status = error.response?.status;
          const message = status
            ? `Failed to load dataset "${dataset.dataset_name}" (HTTP ${status})`
            : `Failed to load dataset "${dataset.dataset_name}": ${error.message || 'Unknown error'}`;
          addMessage({ level: 'danger', message });
        }
      }

      setDatasetObjects(newDatasetObjects);
      setDatasetsLoading(false);
    };

    if (datasets.length > 0) {
      loadDatasets();
    } else {
      // Clear dataset objects when no datasets - use stable reference
      setDatasetObjects(INITIAL_DATASET_OBJECTS);
      setDatasetsLoading(false);
    }
  }, [datasets, addMessage]);

  // Fetch data for current part whenever datasetObjects or currentPart changes
  useEffect(() => {
    if (Object.keys(datasetObjects).length === 0) {
      setFetchedData(INITIAL_FETCHED_DATA);
      setDataLoading(false);
      return;
    }

    const fetchData = async () => {
      setDataLoading(true);
      const newFetchedData = {};

      for (const [datasetName, datasetObj] of Object.entries(datasetObjects)) {
        try {
          const data = await datasetObj.fetchData(currentPart);
          newFetchedData[datasetName] = data;
        } catch (error) {
          console.error(`Failed to fetch data for ${datasetName}:`, error);
          const status = error.response?.status;
          const message = status
            ? `Failed to fetch data for "${datasetName}" (HTTP ${status})`
            : `Failed to fetch data for "${datasetName}": ${error.message || 'Unknown error'}`;
          addMessage({ level: 'danger', message });
        }
      }

      setFetchedData(newFetchedData);
      setDataLoading(false);
    };

    fetchData();

    return () => {
      for (const datasetObj of Object.values(datasetObjects)) {
        datasetObj.cancel();
      }
    };
  }, [datasetObjects, currentPart, addMessage]);

  // Auto-select first project if none selected (only on /app routes)
  React.useEffect(() => {
    if (!currentProject && projects.length > 0 && location.pathname.startsWith('/app')) {
      setCurrentProject(projects[0].id);
    }
  }, [projects, currentProject, setCurrentProject, location.pathname]);

  // Auto-select latest environment if none selected (only on /app routes)
  React.useEffect(() => {
    if (!selectedEnvironment && environments.length > 0 && location.pathname.startsWith('/app')) {
      // Select the last environment (most recently created)
      const latestEnv = environments[environments.length - 1];
      setSelectedEnvironment(latestEnv.id);
    }
  }, [environments, selectedEnvironment, setSelectedEnvironment, location.pathname]);

  const contextValue = useMemo(
    () => ({
      projects,
      projectsLoading,
      currentProject,
      setCurrentProject,
      processes,
      isLoading,
      error: processesError,
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
      datasetObjects,
      datasetCollection: new DatasetCollectionAdapter(datasetObjects),
      datasetsLoading: datasetsLoading || datasetsQueryLoading || (!!activeProcess && isLoading) || (datasets.length > 0 && Object.keys(datasetObjects).length === 0),
      fetchedData,
      dataLoading,
      currentSounding,
      setCurrentSounding,
      // Centralized cache invalidation helpers
      invalidateProcess: invalidateHelpers.invalidateProcess,
      invalidateProject: invalidateHelpers.invalidateProject,
      invalidateDatasets: invalidateHelpers.invalidateDatasets
    }),
    [
      projects,
      projectsLoading,
      currentProject,
      setCurrentProject,
      processes,
      isLoading,
      processesError,
      refetch,
      activeProcess,
      setActiveProcess,
      currentPart,
      setCurrentPart,
      selectedEnvironment,
      setSelectedEnvironment,
      environments,
      environmentsLoading,
      datasets,
      datasetObjects,
      datasetsLoading,
      datasetsQueryLoading,
      fetchedData,
      dataLoading,
      currentSounding,
      setCurrentSounding,
      invalidateHelpers
    ]
  );

  useEffect(() => {
    window.processContext = contextValue;
  }, [contextValue]);

  return (
    <ProcessContext.Provider value={contextValue}>
      {children}
    </ProcessContext.Provider>
  );
}
