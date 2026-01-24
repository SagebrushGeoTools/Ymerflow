import React, { createContext, useState } from 'react';
import { useProcesses, useEnvironments, useProcessOutputDatasets } from "./datamodel/useQueries";

export const ProcessContext = createContext();

export const ProcessProvider = ({ children }) => {
  // activeProcess is now {processId, version} or null
  const [activeProcess, setActiveProcess] = useState(null);
  // currentPart is the part name (e.g., "all" for root, "channel_1" for a part)
  const [currentPart, setCurrentPart] = useState("all");
  // selectedEnvironment is the environment ID
  const [selectedEnvironment, setSelectedEnvironment] = useState(null);

  const { data: processes = [], isLoading, error, refetch } = useProcesses();
  const { data: environments = [], isLoading: environmentsLoading } = useEnvironments();

  // Find the actual process object from activeProcess
  const process = activeProcess ? processes.find(p => p.id === activeProcess.processId) : null;
  const version = activeProcess?.version;

  const { data: datasets = [] } = useProcessOutputDatasets(process, version);

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
        datasets
      }}>
      {children}
    </ProcessContext.Provider>
  );
};
