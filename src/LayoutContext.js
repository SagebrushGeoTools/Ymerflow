import React, { createContext, useState } from 'react';

export const LayoutContext = createContext();

export const LayoutProvider = ({ children }) => {
  const [layout, setLayout] = useState({
    id: 'root',
    widget: 'ClockWidget'
  });

  return (
    <LayoutContext.Provider value={{ layout, updateLayout: setLayout }}>
      {children}
    </LayoutContext.Provider>
  );
};
