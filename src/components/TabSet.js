import React, { useState } from 'react';
import Pane from './Pane';
import { useDrop } from 'react-dnd';
import { v4 as uuidv4 } from "uuid";

export default function TabSet({ parentUpdate, ...node }) {
  const [activeTab, setActiveTab] = useState(node.children[0]?.id);

  const handleChildUpdate = (action, id, newNode) => {
    if (action === 'remove') {
      const newTabs = node.children.filter(t => t.id !== id);
      if (newTabs.length === 0) parentUpdate('remove', node.id);
      else parentUpdate('replace', node.id, { ...node, children: newTabs });
      if (activeTab === id && newTabs.length) setActiveTab(newTabs[0].id);
    } else if (action === 'replace') {
      const newTabs = node.children.map(t => (t.id === id ? { ...t, ...newNode } : t));
      parentUpdate('replace', node.id, { ...node, children: newTabs });
    }
  };

  const addTab = (tabNode) => {
    const newTabs = [...node.children, tabNode];
    parentUpdate('replace', node.id, { ...node, children: newTabs });
    setActiveTab(tabNode.id);
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
        {node.children.map(tab => (
          <li className="nav-item" key={tab.id}>
            <button className={`nav-link tab-mini ${tab.id === activeTab ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>
              {tab.widget}
            </button>
          </li>
        ))}
        <li className="nav-item ms-auto">
          <button className="btn btn-sm btn-primary" onClick={() => addTab({ id: uuidv4(), widget: 'Empty' })}>+</button>
        </li>
      </ul>
      <div className="p-0 flex-grow-1">
        {node.children.map(tab => tab.id === activeTab && (
          <Pane key={tab.id} parentUpdate={handleChildUpdate} {...tab} />
        ))}
      </div>
    </div>
  );
}
