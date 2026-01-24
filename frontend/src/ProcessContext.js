import React, { createContext, useState } from 'react';
import { useProcesses, useEnvironments, useProcessOutputDatasets, useProjects } from "./datamodel/useQueries";

export const ProcessContext = createContext();

export const ProcessProvider = ({ children }) => {
  // activeProcess is now {processId, version} or null
  const [activeProcess, setActiveProcess] = useState(null);
  // currentPart is the part name (e.g., "all" for root, "channel_1" for a part)
  const [currentPart, setCurrentPart] = useState("all");
  // selectedEnvironment is the environment ID
  const [selectedEnvironment, setSelectedEnvironment] = useState(null);
  // currentProject is the project ID
  const [currentProject, setCurrentProject] = useState(null);
  // currentSounding is an index into the flightlines array
  const [currentSounding, setCurrentSounding] = useState(0);

  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: processes = [], isLoading, error, refetch } = useProcesses(currentProject);
  const { data: environments = [], isLoading: environmentsLoading } = useEnvironments();

  // Find the actual process object from activeProcess
  const process = activeProcess ? processes.find(p => p.id === activeProcess.processId) : null;
  const version = activeProcess?.version;

  const { data: datasets = [] } = useProcessOutputDatasets(process, version);

  // Auto-select first project if none selected
  React.useEffect(() => {
    if (!currentProject && projects.length > 0) {
      setCurrentProject(projects[0].id);
    }
  }, [projects, currentProject]);

  // Auto-select latest environment if none selected
  React.useEffect(() => {
    if (!selectedEnvironment && environments.length > 0) {
      // Select the last environment (most recently created)
      const latestEnv = environments[environments.length - 1];
      setSelectedEnvironment(latestEnv.id);
    }
  }, [environments, selectedEnvironment]);

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
