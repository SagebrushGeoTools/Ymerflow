import React from 'react';

export const widgets = {
  ClockWidget: () => <div>🕒 Clock Widget</div>,
  SampleWidget: () => <div>📦 Sample Widget</div>,
  NotesWidget: () => <div>📝 Notes Widget</div>,
  empty: () => <div style={{ color: '#999' }}>Empty Pane</div>
};
