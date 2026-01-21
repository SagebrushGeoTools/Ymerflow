import React, { useContext } from 'react';
import { useParams } from 'react-router-dom';
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

export function PopoutWrapper() {
  const { id } = useParams();
  const { layout } = useContext(LayoutContext);

  // simple search for the node by id
  const findNodeById = (node, id) => {
    if (node.id === id) return node;
    if (node.children) {
      for (const child of node.children) {
        const result = findNodeById(child, id);
        if (result) return result;
      }
    }
    if (node.tabs) {
      for (const tab of node.tabs) {
        if (tab.id === id) return { ...tab, type: 'pane', content: tab.content };
      }
    }
    return null;
  };

  const node = findNodeById(layout, id);
  if (!node) return <div>Component not found</div>;
  return <Pane parentUpdate={null} {...node} />;
}
