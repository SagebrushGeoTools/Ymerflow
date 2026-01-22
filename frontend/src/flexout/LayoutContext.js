import React, { createContext, useState } from 'react';
import Split from "./components/Split";
import TabSet from "./components/TabSet";

export const LayoutContext = createContext();

var VerticalSplit = ({...args}) => <Split splitType="vertical" {...args} />;
VerticalSplit.title = "Split vertically";

var HozisontalSplit = ({...args}) => <Split splitType="horizontal" {...args} />;
HozisontalSplit.title = "Split horizontally";

var Empty = () => <div style={{ color: '#999' }}></div>;
Empty.title = "Empty";

var builtinWidgets = {
  VerticalSplit: VerticalSplit,
  HorizontalSplit: HozisontalSplit,
  TabSet: TabSet,
  Empty: Empty
};
    
export const LayoutProvider = ({ children, widgets, initial_layout, data_context }) => {
  const [layout, setLayout] = useState(
    initial_layout
      || {
        id: 'root',
        widget: 'Empty'
      });

  return (
    <LayoutContext.Provider
      value={{
        widgets: {
          ...widgets,
          ...builtinWidgets},
        layout,
        updateLayout: (layout) => { console.log(layout); setLayout(layout); },
        data_context: data_context || {} }}>
      {children}
    </LayoutContext.Provider>
  );
};
