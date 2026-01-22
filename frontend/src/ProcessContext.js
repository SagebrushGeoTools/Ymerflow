import React, { createContext, useState } from 'react';
import { useProcesses } from "./hooks/useQueries";

export const ProcessContext = createContext();

export const ProcessProvider = ({ children }) => {
  const [activeProcess, setActiveProcess] = useState(null);
  const { data: processes = [], isLoading, error, refetch } = useProcesses();

  return (
    <ProcessContext.Provider
      value={{
        processes,
        isLoading,
        error,
        refetchProcesses: refetch,
        activeProcess,
        setActiveProcess
      }}>
      {children}
    </ProcessContext.Provider>
  );
};
