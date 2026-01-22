import React, { useContext } from 'react';
import { LayoutContext } from '../LayoutContext';
import Split from './Split';
import TabSet from './TabSet';
import { useDrag, useDrop } from 'react-dnd';
import { v4 as uuidv4 } from "uuid";

// Helper: remove a node by id from layout tree
function removeNodeById(node, id) {
  if (node.id === id) return { newTree: null, removedNode: node };

  if (node.widget === 'VerticalSplit' || node.widget === 'HorizontalSplit') {
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

  if (node.widget === 'TabSet') {
    const tabs = node.children.filter(t => t.id !== id);
    const removedNode = node.children.find(t => t.id === id);
    if (removedNode) return { newTree: { ...node, tabs }, removedNode };
    return { newTree: node, removedNode: null };
  }

  return { newTree: node, removedNode: null };
}

// Helper: insert dragged node at target
function insertNodeAtTarget(targetNode, draggedNode, splitType = 'vertical') {
  if (targetNode.type === 'pane' && targetNode.widget === 'empty') return draggedNode;
  if (targetNode.type === 'pane') {
    return { type: 'split', splitType, size: 0.5, children: [targetNode, draggedNode] };
  }
  if (targetNode.type === 'TabSet') {
    const newTabs = [...targetNode.children, { id: draggedNode.id, title: draggedNode.widget, content: draggedNode.content }];
    return { ...targetNode, tabs: newTabs };
  }
  return targetNode;
}

export default function Pane({ parentUpdate, ...node }) {
  const { layout, updateLayout, widgets } = useContext(LayoutContext);

  const handleRemove = () => {
    if (parentUpdate) parentUpdate('remove', node.id);
    else updateLayout({ type: 'pane', id: 'root', content: { widget: 'empty' } });
  };

  const handleChangeContent = (e) => {
    const type = e.target.value;
    const newNode = { ...node, widget: type };

    if (type === 'VerticalSplit' || type === 'HorizontalSplit') {
      newNode.children = [
        { id: uuidv4(), widget: 'Empty' },
        { id: uuidv4(), widget: 'Empty' }
      ];
    } else if (type === 'TabSet') {
      newNode.children = [
        { id: uuidv4(), widget: 'Empty' }
      ];
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

      const { newTree, removedNode } = removeNodeById(layout, dragged.node.id);
      if (!removedNode) return;

      const newLayout = insertNodeAtTarget(node, removedNode, 'vertical');
      updateLayout(newLayout);
    }
  });

  const style = { opacity: isDragging ? 0.5 : 1
                };

  const Widget = widgets[node.widget] || (() => <div>Unknown Widget: {node.widget} </div>);
  
  return (
    <div ref={drop} style={style} className="border d-flex flex-column h-100">
      <div ref={drag} className="d-flex justify-content-between bg-light border-bottom align-items-center ps-1 pane-header">
        <div>{Widget.title}</div>
        <div>
          <select className="form-select d-inline w-auto me-2" value={node.widget} onChange={handleChangeContent}>
            {Object.entries(widgets).map(([name, widget]) =>
              <option key={name} value={name}>{widget.title}</option>
            )}
          </select>
          <button className="btn btn-secondary me-1" onClick={handlePopout}><i className="fas fa-external-link-alt"></i></button>
          <button className="btn btn-danger" onClick={handleRemove}><i className="fas fa-times"></i></button>
        </div>
      </div>
      <div className="p-1 flex-grow-1 overflow-auto">
        <Widget parentUpdate={parentUpdate} {...node} />
      </div>
    </div>
  );
}
