import React, { useContext, useEffect } from 'react';
import Pane from './Pane';
import { useDrag, useDrop } from 'react-dnd';
import { v4 as uuidv4 } from "uuid";
import { LayoutContext } from '../LayoutContext';

// Recursively remove a tab (tabId) from a specific TabSet (tabSetId) in the full layout tree.
// Returns null if the TabSet itself should be removed (became empty).
// Collapses single-child splits automatically.
function removeTabFromTree(node, tabSetId, tabId) {
  if (node.id === tabSetId) {
    const newChildren = node.children.filter(t => t.id !== tabId);
    if (newChildren.length === 0) return null;
    const nextActive = newChildren.find(t => t.id === node.activeTab)
      ? node.activeTab
      : newChildren[0].id;
    return { ...node, children: newChildren, activeTab: nextActive };
  }
  if (!node.children) return node;
  let changed = false;
  const newChildren = [];
  for (const child of node.children) {
    const newChild = removeTabFromTree(child, tabSetId, tabId);
    if (newChild !== child) changed = true;
    if (newChild !== null) newChildren.push(newChild);
    else changed = true;
  }
  if (!changed) return node;
  if ((node.widget === 'VerticalSplit' || node.widget === 'HorizontalSplit') && newChildren.length === 1) {
    return newChildren[0]; // collapse split
  }
  return { ...node, children: newChildren };
}

// A single draggable/droppable tab header button.
function TabHeader({ tab, index, isActive, onActivate, onInsertBefore, onRemoveTab, widgets }) {
  const Widget = widgets[tab.widget] || (() => null);
  const title = tab.customTitle !== undefined ? tab.customTitle : Widget.title;

  // Dragging a tab header moves it (end callback removes the source tab after a successful drop).
  const [{ isDragging }, drag] = useDrag({
    type: 'pane',
    item: { node: tab },
    end: (_item, monitor) => {
      if (monitor.didDrop()) {
        onRemoveTab(tab.id);
      }
    },
    collect: monitor => ({ isDragging: monitor.isDragging() })
  });

  // Dropping on a tab header inserts the dragged pane before this tab.
  const [{ isOver }, drop] = useDrop({
    accept: 'pane',
    drop: (dragged, monitor) => {
      if (monitor.didDrop()) return;
      if (dragged.node.id === tab.id) return {}; // self-drop: consume, no action
      onInsertBefore(index, dragged.node);
      return {};
    },
    collect: monitor => ({ isOver: monitor.isOver({ shallow: true }) })
  });

  return (
    <li
      ref={drop}
      className="nav-item"
      style={{ borderLeft: isOver ? '2px solid #0d6efd' : '2px solid transparent' }}
    >
      <button
        ref={drag}
        className={`nav-link tab-mini ${isActive ? 'active' : ''}`}
        onClick={onActivate}
        style={{ opacity: isDragging ? 0.5 : 1, cursor: 'grab' }}
      >
        {title || '\u00A0'}
      </button>
    </li>
  );
}

export default function TabSet({ parentUpdate, ...node }) {
  const { widgets, updateLayout } = useContext(LayoutContext);
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
      const nextActive = activeTab === id ? newNode.id : activeTab;
      parentUpdate('replace', node.id, { ...node, children: newTabs, activeTab: nextActive });
    }
  };

  // Insert a copy of tabNode at a specific index in the tab bar.
  const insertTabAt = (index, tabNode) => {
    const newTab = { ...tabNode, id: uuidv4() };
    const newTabs = [...node.children];
    newTabs.splice(index, 0, newTab);
    parentUpdate('replace', node.id, { ...node, children: newTabs, activeTab: newTab.id });
  };

  // Append a copy of tabNode to the end of the tab list.
  const addTab = (tabNode) => {
    const newTab = { ...tabNode, id: uuidv4() };
    const newTabs = [...node.children, newTab];
    parentUpdate('replace', node.id, { ...node, children: newTabs, activeTab: newTab.id });
  };

  // Remove a tab from this TabSet via a functional layout update so it composes correctly
  // with any insert that was already queued in the same React batch (avoids stale-closure clobber).
  const removeTabFromSource = (tabId) => {
    updateLayout(prevLayout => removeTabFromTree(prevLayout, node.id, tabId) ?? prevLayout);
  };

  // Fallback drop zone on the content area — adds at end when no tab header caught the drop.
  const [, drop] = useDrop({
    accept: 'pane',
    drop: (dragged, monitor) => {
      if (monitor.didDrop()) return;
      addTab(dragged.node);
      return {};
    }
  });

  return (
    <div ref={drop} className="h-100 flex-column d-flex">
      <ul className="nav nav-tabs">
        {node.children.map((tab, index) => (
          <TabHeader
            key={tab.id}
            tab={tab}
            index={index}
            isActive={tab.id === activeTab}
            onActivate={() => setActiveTab(tab.id)}
            onInsertBefore={insertTabAt}
            onRemoveTab={removeTabFromSource}
            widgets={widgets}
          />
        ))}
        <li className="nav-item">
          <button className="nav-link tab-mini" onClick={() => addTab({ id: uuidv4(), widget: 'Empty' })}>+</button>
        </li>
      </ul>
      <div className="p-0 flex-grow-1 position-relative">
        {node.children.map(tab => (
          <div
            key={tab.id}
            className="position-absolute top-0 start-0 w-100 h-100"
            style={{ display: tab.id === activeTab ? 'block' : 'none' }}
          >
            <Pane parentUpdate={handleChildUpdate} onTabMoved={() => removeTabFromSource(tab.id)} {...tab} />
          </div>
        ))}
      </div>
    </div>
  );
}

TabSet.title = "Tabs";
