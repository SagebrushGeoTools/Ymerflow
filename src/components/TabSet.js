import React, { useState } from 'react';
import Pane from './Pane';
import { useDrop } from 'react-dnd';

export default function TabSet({ node, parentUpdate }) {
  const [activeTab, setActiveTab] = useState(node.tabs[0]?.id);

  const handleChildUpdate = (action, id, newNode) => {
    if (action === 'remove') {
      const newTabs = node.tabs.filter(t => t.id !== id);
      if (newTabs.length === 0) parentUpdate('remove', node.id);
      else parentUpdate('replace', node.id, { ...node, tabs: newTabs });
      if (activeTab === id && newTabs.length) setActiveTab(newTabs[0].id);
    } else if (action === 'replace') {
      const newTabs = node.tabs.map(t => (t.id === id ? { ...t, ...newNode } : t));
      parentUpdate('replace', node.id, { ...node, tabs: newTabs });
    }
  };

  const addTab = (tabNode) => {
    const newTabs = [...node.tabs, { id: tabNode.id, title: tabNode.content.widget, content: tabNode.content }];
    parentUpdate('replace', node.id, { ...node, tabs: newTabs });
    setActiveTab(tabNode.id);
  };

  const [, drop] = useDrop({
    accept: 'pane',
    drop: (dragged) => {
      addTab(dragged.node);
    }
  });

  return (
    <div ref={drop} className="border m-1">
      <ul className="nav nav-tabs">
        {node.tabs.map(tab => (
          <li className="nav-item" key={tab.id}>
            <button className={`nav-link ${tab.id === activeTab ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>
              {tab.title}
            </button>
          </li>
        ))}
        <li className="nav-item ms-auto">
          <button className="btn btn-sm btn-primary" onClick={() => addTab({ id: node.id + '-tab' + (node.tabs.length + 1), title: 'New Tab', content: { widget: 'ClockWidget' } })}>+</button>
        </li>
      </ul>
      <div className="p-2">
        {node.tabs.map(tab => tab.id === activeTab && (
          <Pane key={tab.id} node={{ ...tab, type: 'pane', content: tab.content }} parentUpdate={handleChildUpdate} />
        ))}
      </div>
    </div>
  );
}
