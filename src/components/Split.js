import React, { useState } from 'react';
import Pane from './Pane';

export default function Split({ parentUpdate, ...node}) {
  const [dragging, setDragging] = useState(false);
  const [dragPos, setDragPos] = useState(null);

  const handleChildUpdate = (action, id, newNode) => {
    if (action === 'remove') {
      const otherChild = node.children.find(c => c.id !== id);
      if (otherChild) parentUpdate('replace', node.id, otherChild);
      else parentUpdate('remove', node.id);
    } else if (action === 'replace') {
      const newChildren = node.children.map(c => (c.id === id ? newNode : c));
      parentUpdate('replace', node.id, { ...node, children: newChildren });
    }
  };

  const splitType = node.splitType;
  const size = node.size || 0.5;

  const onMouseDown = (e) => {
    setDragging(true);
    setDragPos(splitType === 'vertical' ? e.clientX : e.clientY);
  };

  const onMouseMove = (e) => {
    if (!dragging) return;
    const delta = (splitType === 'vertical' ? e.clientX : e.clientY) - dragPos;
    const container = e.currentTarget.getBoundingClientRect();
    let newSize = splitType === 'vertical'
      ? (size * container.width + delta) / container.width
      : (size * container.height + delta) / container.height;
    if (newSize < 0.1) newSize = 0.1;
    if (newSize > 0.9) newSize = 0.9;

    parentUpdate('replace', node.id, { ...node, size: newSize });
    setDragPos(splitType === 'vertical' ? e.clientX : e.clientY);
  };

  const onMouseUp = () => setDragging(false);

  const containerStyle = {
    display: 'flex',
    flexDirection: splitType === 'vertical' ? 'row' : 'column',
    height: '100%',
    width: '100%',
    position: 'relative'
  };
  const firstStyle = { flexBasis: `${size * 100}%`, flexShrink: 0, overflow: 'auto' };
  const secondStyle = { flex: 1, overflow: 'auto' };
  const dividerStyle = splitType === 'vertical' ? { width: '5px', cursor: 'col-resize', background: '#ccc' } : { height: '5px', cursor: 'row-resize', background: '#ccc' };

  return (
    <div style={containerStyle} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
      <div style={firstStyle}><Pane parentUpdate={handleChildUpdate} {...node.children[0]}/></div>
      <div style={dividerStyle} onMouseDown={onMouseDown} />
      <div style={secondStyle}><Pane parentUpdate={handleChildUpdate} {...node.children[1]} /></div>
    </div>
  );
}
