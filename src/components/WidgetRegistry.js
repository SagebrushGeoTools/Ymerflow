import React from 'react';
import Split from "./Split";
import TabSet from "./TabSet";

export const widgets = {
  VerticalSplit: ({...args}) => <Split splitType="vertical" {...args} />,
  HorizontalSplit: ({...args}) => <Split splitType="horizontal" {...args} />,
  TabSet: TabSet,
  ClockWidget: () => <div>🕒 Clock Widget</div>,
  SampleWidget: () => <div>📦 Sample Widget</div>,
  NotesWidget: () => <div>📝 Notes Widget</div>,
  Empty: () => <div style={{ color: '#999' }}></div>
};
