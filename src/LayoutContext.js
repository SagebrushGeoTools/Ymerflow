import React, { createContext, useState } from 'react';

export const LayoutContext = createContext();

export const LayoutProvider = ({ children }) => {
  const [layout, setLayout] = useState({
    type: 'pane',
    id: 'root',
    content: { widget: 'ClockWidget' }
  });

  return (
    <LayoutContext.Provider value={{ layout, updateLayout: setLayout }}>
      {children}
    </LayoutContext.Provider>
  );
};
