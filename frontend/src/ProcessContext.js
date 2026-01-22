import React, { createContext, useState } from 'react';
import { useProcesses } from "./hooks/useQueries";

export const ProcessContext = createContext();

export const ProcessProvider = ({ children }) => {
  // activeProcess is now {processId, version} or null
  const [activeProcess, setActiveProcess] = useState(null);
  // currentPart is the part name (e.g., "all" for root, "channel_1" for a part)
  const [currentPart, setCurrentPart] = useState("all");
  const { data: processes = [], isLoading, error, refetch } = useProcesses();

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
        setCurrentPart
      }}>
      {children}
    </ProcessContext.Provider>
  );
};
