import React, { useContext } from 'react';
import { LayoutContext } from '../LayoutContext';
import Split from './Split';
import TabSet from './TabSet';
import { widgets } from './WidgetRegistry';
import { useDrag, useDrop } from 'react-dnd';

// Helper: remove a node by id from layout tree
function removeNodeById(node, id) {
  if (node.id === id) return { newTree: null, removedNode: node };

  if (node.type === 'split') {
    const children = [];
    let removedNode = null;
    for (let child of node.children) {
      const result = removeNodeById(child, id);
      if (result.removedNode) removedNode = result.removedNode;
      if (result.newTree) children.push(result.newTree);
    }
    if (!removedNode) return { newTree: node, removedNode: null };
    if (children.length === 0) return { newTree: null, removedNode };
    if (children.length === 1) return { newTree: children[0], removedNode };
    return { newTree: { ...node, children }, removedNode };
  }

  if (node.type === 'tabset') {
    const tabs = node.tabs.filter(t => t.id !== id);
    const removedNode = node.tabs.find(t => t.id === id);
    if (removedNode) return { newTree: { ...node, tabs }, removedNode };
    return { newTree: node, removedNode: null };
  }

  return { newTree: node, removedNode: null };
}

// Helper: insert dragged node at target
function insertNodeAtTarget(targetNode, draggedNode, splitType = 'vertical') {
  if (targetNode.type === 'pane' && targetNode.content.widget === 'empty') return draggedNode;
  if (targetNode.type === 'pane') {
    return { type: 'split', splitType, size: 0.5, children: [targetNode, draggedNode] };
  }
  if (targetNode.type === 'tabset') {
    const newTabs = [...targetNode.tabs, { id: draggedNode.id, title: draggedNode.content.widget, content: draggedNode.content }];
    return { ...targetNode, tabs: newTabs };
  }
  return targetNode;
}

export default function Pane({ node, parentUpdate }) {
  const { layout, updateLayout } = useContext(LayoutContext);

  const handleRemove = () => {
    if (parentUpdate) parentUpdate('remove', node.id);
    else updateLayout({ type: 'pane', id: 'root', content: { widget: 'empty' } });
  };

  const handleChangeContent = (e) => {
    const type = e.target.value;
    const newNode = { ...node };

    if (type === 'split-vertical' || type === 'split-horizontal') {
      newNode.type = 'split';
      newNode.splitType = type === 'split-vertical' ? 'vertical' : 'horizontal';
      newNode.children = [
        { type: 'pane', id: node.id + '-1', content: { widget: 'ClockWidget' } },
        { type: 'pane', id: node.id + '-2', content: { widget: 'SampleWidget' } }
      ];
    } else if (type === 'tabset') {
      newNode.type = 'tabset';
      newNode.tabs = [
        { id: node.id + '-tab1', title: 'Tab 1', content: { widget: 'ClockWidget' } },
        { id: node.id + '-tab2', title: 'Tab 2', content: { widget: 'SampleWidget' } }
      ];
    } else {
      newNode.type = 'pane';
      newNode.content = { widget: type };
    }

    if (parentUpdate) parentUpdate('replace', node.id, newNode);
    else updateLayout(newNode);
  };

  const handlePopout = () => {
    window.open(`/popout/${node.id}`, '_blank', 'width=600,height=400');
  };

  // -------------------------------
  // Drag and Drop
  const [{ isDragging }, drag] = useDrag({
    type: 'pane',
    item: { node },
    collect: (monitor) => ({ isDragging: monitor.isDragging() })
  });

  const [, drop] = useDrop({
    accept: 'pane',
    drop: (dragged) => {
      if (dragged.node.id === node.id) return;

      // Remove dragged node from layout
      const { newTree, removedNode } = removeNodeById(layout, dragged.node.id);
      if (!removedNode) return;

      // Insert dragged node at target
      const newLayout = insertNodeAtTarget(node, removedNode, 'vertical');
      updateLayout(newLayout);
    }
  });

  const style = { opacity: isDragging ? 0.5 : 1 };

  if (node.type === 'split') return <Split node={node} parentUpdate={parentUpdate} />;
  if (node.type === 'tabset') return <TabSet node={node} parentUpdate={parentUpdate} />;

  const Widget = widgets[node.content.widget] || (() => <div>Unknown Widget</div>);

  return (
    <div ref={drop} style={style} className="border m-1">
      <div ref={drag} className="d-flex justify-content-between bg-light p-1 border-bottom">
        <div>{node.content.widget}</div>
        <div>
          <select className="form-select d-inline w-auto me-2" value={node.content.widget} onChange={handleChangeContent}>
            <option value="ClockWidget">Clock</option>
            <option value="SampleWidget">Sample</option>
            <option value="NotesWidget">Notes</option>
            <option value="empty">Empty</option>
            <option value="split-vertical">Split Vertical</option>
            <option value="split-horizontal">Split Horizontal</option>
            <option value="tabset">Tab Set</option>
          </select>
          <button className="btn btn-sm btn-secondary me-1" onClick={handlePopout}><i className="fas fa-external-link-alt"></i></button>
          <button className="btn btn-sm btn-danger" onClick={handleRemove}><i className="fas fa-times"></i></button>
        </div>
      </div>
      <div className="p-2"><Widget /></div>
    </div>
  );
}
