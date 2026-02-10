import React, { createContext, useCallback, useMemo, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useProcesses, useEnvironments, useProcessOutputDatasets, useProjects } from "./datamodel/useQueries";
import { loadDataset } from './datamodel/dataset';
import { useWebSocket } from './hooks/useWebSocket';

export const ProcessContext = createContext();

// Moved outside component to avoid recreation
const INITIAL_DATASET_OBJECTS = {};
const INITIAL_FETCHED_DATA = {};
const INITIAL_FETCHED_GEOGRAPHY = {};
const EMPTY_ARRAY = [];

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
  const queryClient = useQueryClient();

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

  const { data: projects = EMPTY_ARRAY, isLoading: projectsLoading } = useProjects();
  const { data: processes = EMPTY_ARRAY, isLoading, error, refetch } = useProcesses(currentProject);
  const { data: environments = EMPTY_ARRAY, isLoading: environmentsLoading } = useEnvironments();
  
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

  // Stable WebSocket callbacks wrapped in useCallback to prevent reconnection loops
  const handleWebSocketOpen = useCallback(() => {
    console.log(`  - Active queries watching 'processes':`, queryClient.getQueryCache().findAll({ queryKey: ['processes'] }).length);
  }, [queryClient]);

  const handleWebSocketMessage = useCallback((update) => {
    console.log(`  - Invalidating queries for ['processes', '${currentProject}']`);

    // Invalidate and refetch processes to get updated state
    // Using refetchType: 'active' to immediately refetch active queries
    queryClient.invalidateQueries({
      queryKey: ['processes', currentProject],
      refetchType: 'active'
    });

    console.log('  - Query invalidation complete');
  }, [queryClient, currentProject]);

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
  }, [datasets]);

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
  }, [datasetObjects, currentPart]);

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

  const contextValue = useMemo(
    () => ({
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
      datasetObjects,
      datasetsLoading,
      fetchedData,
      fetchedGeography,
      dataLoading,
      currentSounding,
      setCurrentSounding
    }),
    [
      projects,
      projectsLoading,
      currentProject,
      setCurrentProject,
      processes,
      isLoading,
      error,
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
      setCurrentSounding
    ]
  );

  return (
    <ProcessContext.Provider value={contextValue}>
      {children}
    </ProcessContext.Provider>
  );
};
