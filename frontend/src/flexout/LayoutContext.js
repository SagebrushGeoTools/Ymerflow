import React, { createContext, useState, useCallback, useMemo } from 'react';
import Split from "./components/Split";
import TabSet from "./components/TabSet";
import { findWidgetPaths, applyPath } from './layoutUtils';

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

  const updateLayout = useCallback((newLayout) => {
    console.log(newLayout);
    setLayout(newLayout);
  }, []);

  const activatePath = useCallback((path) => {
    setLayout(current => applyPath(current, path));
  }, []);

  const allWidgets = useMemo(
    () => ({
      ...widgets,
      ...builtinWidgets
    }),
    [widgets]
  );

  const contextValue = useMemo(
    () => ({
      widgets: allWidgets,
      layout,
      updateLayout,
      data_context: data_context || {},
      findWidgetPaths: (widgetType) => findWidgetPaths(layout, widgetType),
      activatePath,
    }),
    [allWidgets, layout, updateLayout, data_context, activatePath]
  );

  return (
    <LayoutContext.Provider value={contextValue}>
      {children}
    </LayoutContext.Provider>
  );
};
