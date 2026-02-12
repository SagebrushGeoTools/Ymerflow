import React, { createContext, useCallback, useMemo, useState, useEffect, useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useProcesses, useEnvironments, useProcessOutputDatasets, useProjects } from "./datamodel/useQueries";
import { loadDataset } from './datamodel/dataset';
import { useWebSocket } from './hooks/useWebSocket';
import { MessageContext } from './MessageContext';

export const ProcessContext = createContext();

// Moved outside component to avoid recreation
const INITIAL_DATASET_OBJECTS = {};
const INITIAL_FETCHED_DATA = {};
const INITIAL_FETCHED_GEOGRAPHY = {};
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

export const ProcessProvider = ({ children }) => {
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

  // Debug: Log when currentProject or processes change
  useEffect(() => {
    console.log('[ProcessContext] currentProject changed:', currentProject);
  }, [currentProject]);

  useEffect(() => {
    console.log('[ProcessContext] processes changed:', processes.length, 'processes', 'isLoading:', isLoading);
  }, [processes, isLoading]);

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

  // Centralized cache invalidation helpers
  const invalidateHelpers = useMemo(() => ({
    // Invalidate a specific process and all its related data
    invalidateProcess: async (processId, projectId = currentProject) => {
      console.log(`  - Invalidating process ${processId} in project ${projectId} and its outputs`);
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
      console.log(`  - Process ${processId} refetch complete`);
    },

    // Invalidate all processes and related data for current project (or specified project)
    invalidateProject: async (projectId = currentProject) => {
      console.log(`  - Invalidating all process data for project ${projectId}`);
      console.log(`  - Query key: ['processes', '${projectId}']`);
      console.log(`  - currentProject from context: ${currentProject}`);

      // Debug: Show all queries in cache
      const allQueries = queryClient.getQueryCache().getAll();
      console.log(`  - Total queries in cache: ${allQueries.length}`);
      const processQueries = allQueries.filter(q => q.queryKey[0] === 'processes');
      console.log(`  - Process queries:`, processQueries.map(q => ({ key: q.queryKey, state: q.state.status })));

      // Directly refetch processes and wait for completion
      const processesResult = await queryClient.refetchQueries({
        queryKey: ['processes', projectId]
      });

      // Also invalidate processOutputDatasets (fire and forget)
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'processOutputDatasets',
        refetchType: 'active'
      });

      console.log(`  - Project ${projectId} refetch complete`);

      // Log the current state
      const processesQuery = queryClient.getQueryState(['processes', projectId]);
      console.log(`  - Processes query state:`, processesQuery?.status);
      console.log(`  - Processes data length:`, processesQuery?.data?.length);
      console.log(`  - Refetch result:`, processesResult);
    },

    // Invalidate datasets
    invalidateDatasets: async () => {
      console.log(`  - Invalidating datasets`);
      await queryClient.refetchQueries({
        queryKey: ['datasets'],
        type: 'active'
      });
      console.log(`  - Datasets refetch complete`);
    }
  }), [queryClient, currentProject]);

  // Stable WebSocket callbacks wrapped in useCallback to prevent reconnection loops
  const handleWebSocketOpen = useCallback(() => {
    console.log(`  - Active queries watching 'processes':`, queryClient.getQueryCache().findAll({ queryKey: ['processes'] }).length);
  }, [queryClient]);

  const handleWebSocketMessage = useCallback(async (update) => {
    // Use centralized invalidation helper
    await invalidateHelpers.invalidateProject();
    console.log('  - Query refetch complete');
  }, [invalidateHelpers]);

  // WebSocket for process state updates with auto-reconnect
  useWebSocket('ws://localhost:8000/ws/processes/updates', {
    enabled: !!currentProject,
    name: 'Process State Updates',
    onOpen: handleWebSocketOpen,
    onMessage: handleWebSocketMessage
  });

  // Find the actual process object from activeProcess
  const process = activeProcess ? processes.find(p => p.id === activeProcess.processId) : null;
  const version = activeProcess?.version;

  const { data: datasets = EMPTY_ARRAY } = useProcessOutputDatasets(process, version);

  // State for dataset objects and data - use stable initial values
  const [datasetObjects, setDatasetObjects] = useState(INITIAL_DATASET_OBJECTS);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [fetchedData, setFetchedData] = useState(INITIAL_FETCHED_DATA);
  const [fetchedGeography, setFetchedGeography] = useState(INITIAL_FETCHED_GEOGRAPHY);
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

  // Fetch data and geography for current part whenever datasetObjects or currentPart changes
  useEffect(() => {
    const fetchDataAndGeography = async () => {
      setDataLoading(true);
      const newFetchedData = {};
      const newFetchedGeography = {};

      for (const [datasetName, datasetObj] of Object.entries(datasetObjects)) {
        try {
          // Fetch data for current part
          const data = await datasetObj.getData(currentPart);
          newFetchedData[datasetName] = data;

          // Fetch geography for "all" (MapView always shows all with highlighting)
          const geography = await datasetObj.getGeography("all");
          newFetchedGeography[datasetName] = geography;
        } catch (error) {
          console.error(`Failed to fetch data/geography for ${datasetName}:`, error);
          const status = error.response?.status;
          const message = status
            ? `Failed to fetch data for "${datasetName}" (HTTP ${status})`
            : `Failed to fetch data for "${datasetName}": ${error.message || 'Unknown error'}`;
          addMessage({ level: 'danger', message });
        }
      }

      setFetchedData(newFetchedData);
      setFetchedGeography(newFetchedGeography);
      setDataLoading(false);
    };

    if (Object.keys(datasetObjects).length > 0) {
      fetchDataAndGeography();
    } else {
      // Clear data when no dataset objects - use stable references
      setFetchedData(INITIAL_FETCHED_DATA);
      setFetchedGeography(INITIAL_FETCHED_GEOGRAPHY);
      setDataLoading(false);
    }
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
      datasetsLoading,
      fetchedData,
      fetchedGeography,
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
      fetchedData,
      fetchedGeography,
      dataLoading,
      currentSounding,
      setCurrentSounding,
      invalidateHelpers
    ]
  );

  return (
    <ProcessContext.Provider value={contextValue}>
      {children}
    </ProcessContext.Provider>
  );
};
