import React, { useContext } from 'react';
import { LayoutProvider, LayoutContext } from './LayoutContext';
import Pane from './components/Pane';

export function MainLayout() {
  const { layout, updateLayout } = useContext(LayoutContext);

  // root-level parentUpdate simply replaces the root layout
  const rootParentUpdate = (action, id, newNode) => {
    if (action === 'replace') updateLayout(newNode);
    if (action === 'remove') updateLayout({ type: 'pane', id: 'root', content: { widget: 'ClockWidget' } });
  };

  return <Pane parentUpdate={rootParentUpdate} {...layout} />;
}
