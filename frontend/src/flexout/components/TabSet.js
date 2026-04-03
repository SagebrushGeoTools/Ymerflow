import React, { useContext, useEffect } from 'react';
import Pane from './Pane';
import { useDrop } from 'react-dnd';
import { v4 as uuidv4 } from "uuid";
import { LayoutContext } from '../LayoutContext';

export default function TabSet({ parentUpdate, ...node }) {
  const { widgets } = useContext(LayoutContext);
  const activeTab = node.activeTab ?? node.children[0]?.id;

  const setActiveTab = (id) => {
    parentUpdate('replace', node.id, { ...node, activeTab: id });
  };

  // Ensure activeTab is always valid when children change
  useEffect(() => {
    const validIds = node.children.map(child => child.id);
    if (!validIds.includes(activeTab) && validIds.length > 0) {
      setActiveTab(validIds[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.children, activeTab]);

  const handleChildUpdate = (action, id, newNode) => {
    if (action === 'remove') {
      const newTabs = node.children.filter(t => t.id !== id);
      if (newTabs.length === 0) parentUpdate('remove', node.id);
      else {
        const nextActive = activeTab === id ? newTabs[0]?.id : activeTab;
        parentUpdate('replace', node.id, { ...node, children: newTabs, activeTab: nextActive });
      }
    } else if (action === 'replace') {
      const newTabs = node.children.map(t => (t.id === id ? { ...t, ...newNode } : t));
      parentUpdate('replace', node.id, { ...node, children: newTabs });
    }
  };

  const addTab = (tabNode) => {
    const newTabs = [...node.children, tabNode];
    parentUpdate('replace', node.id, { ...node, children: newTabs, activeTab: tabNode.id });
  };

  const [, drop] = useDrop({
    accept: 'pane',
    drop: (dragged) => {
      addTab(dragged.node);
    }
  });

  return (
    <div ref={drop} className="border h-100 flex-column d-flex">
      <ul className="nav nav-tabs">
        {node.children.map(tab => {
          const Widget = widgets[tab.widget] || (() => <div>Unknown Widget: {tab.widget}</div>);
          const title = tab.customTitle !== undefined ? tab.customTitle : Widget.title;
          return (
            <li className="nav-item" key={tab.id}>
              <button className={`nav-link tab-mini ${tab.id === activeTab ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>
                {title || '\u00A0'}
              </button>
            </li>
          );
        })}
        <li className="nav-item ms-auto">
          <button className="btn btn-sm btn-primary" onClick={() => addTab({ id: uuidv4(), widget: 'Empty' })}>+</button>
        </li>
      </ul>
      <div className="p-0 flex-grow-1 position-relative">
        {node.children.map(tab => (
          <div
            key={tab.id}
            className="position-absolute top-0 start-0 w-100 h-100"
            style={{ display: tab.id === activeTab ? 'block' : 'none' }}
          >
            <Pane parentUpdate={handleChildUpdate} {...tab} />
          </div>
        ))}
      </div>
    </div>
  );
}

TabSet.title = "Tabs";
