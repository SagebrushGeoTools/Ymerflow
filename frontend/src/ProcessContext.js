import React, { createContext, useState, useEffect } from 'react';
import { getProcesses } from "./api";

export const ProcessContext = createContext();
    
export const ProcessProvider = ({ children }) => {
  const [processes, setProcesses] = useState([]);
  const [activeProcess, setActiveProcess] = useState(null);

  useEffect(() => {
    getProcesses().then(setProcesses);
  }, []);
  
  return (
    <ProcessContext.Provider
      value={{
        processes,
        setProcesses,
        activeProcess,
        setActiveProcess
      }}>
      {children}
    </ProcessContext.Provider>
  );
};
