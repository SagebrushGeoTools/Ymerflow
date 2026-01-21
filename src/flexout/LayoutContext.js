import React, { createContext, useState } from 'react';
import Split from "./components/Split";
import TabSet from "./components/TabSet";

export const LayoutContext = createContext();

var builtinWidgets = {
  VerticalSplit: ({...args}) => <Split splitType="vertical" {...args} />,
  HorizontalSplit: ({...args}) => <Split splitType="horizontal" {...args} />,
  TabSet: TabSet,
  Empty: () => <div style={{ color: '#999' }}></div>
};
    
export const LayoutProvider = ({ children, widgets }) => {
  const [layout, setLayout] = useState({
    id: 'root',
    widget: 'ClockWidget'
  });
  
  return (
    <LayoutContext.Provider
      value={{
        widgets: {
          ...widgets,
          ...builtinWidgets},
        layout,
        updateLayout: (layout) => { console.log(layout); setLayout(layout); } }}>
      {children}
    </LayoutContext.Provider>
  );
};
