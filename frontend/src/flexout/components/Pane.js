import React, { useContext, useState, Component, useMemo } from 'react';
import { LayoutContext } from '../LayoutContext';
import Split from './Split';
import TabSet from './TabSet';
import { useDrag, useDrop } from 'react-dnd';
import { v4 as uuidv4 } from "uuid";
import { Modal, Button } from 'react-bootstrap';
import { CustomForm } from '../../jsoneditor';
import validator from "@rjsf/validator-ajv8";

// Error Boundary to catch widget crashes
class WidgetErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Widget error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  componentDidUpdate(prevProps) {
    // Reset error state if widget type changes or configuration changes
    if (prevProps.widgetName !== this.props.widgetName || prevProps.node !== this.props.node) {
      this.setState({ hasError: false, error: null, errorInfo: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="d-flex flex-column align-items-center justify-content-center h-100 p-3">
          <div className="alert alert-danger w-100">
            <h5 className="alert-heading">
              <i className="fas fa-exclamation-triangle me-2"></i>
              Widget Error
            </h5>
            <p className="mb-2">
              The <strong>{this.props.widgetName}</strong> widget encountered an error and could not be displayed.
            </p>
            {this.state.error && (
              <details className="mt-2">
                <summary style={{ cursor: 'pointer' }}>Error details</summary>
                <pre className="mt-2 mb-0 small" style={{ whiteSpace: 'pre-wrap' }}>
                  {this.state.error.toString()}
                  {this.state.errorInfo && this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}
            <hr />
            <p className="mb-0 small">
              Use the dropdown above to select a different widget or try refreshing the page.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

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
  const { layout, updateLayout, widgets, data_context } = useContext(LayoutContext);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const Widget = widgets[node.widget] || (() => <div>Unknown Widget: {node.widget}</div>);
  const hasConfig = Widget.get_schema && typeof Widget.get_schema === 'function';

  const handleConfigure = () => {
    setShowConfigModal(true);
  };

  const handleConfigSubmit = ({ formData }) => {
    if (parentUpdate) {
      parentUpdate('replace', node.id, formData);
    } else {
      updateLayout(formData);
    }
    setShowConfigModal(false);
  };

  // Merge node with defaults for form initialization - memoized
  const formData = useMemo(() => {
    if (!hasConfig) return node;

    if (Widget.get_default && typeof Widget.get_default === 'function') {
      const defaults = Widget.get_default(data_context);
      // Merge defaults with current node, keeping existing values
      return { ...defaults, ...node };
    }
    return node;
  }, [hasConfig, node, Widget, data_context]);

  const handleRemove = () => {
    if (parentUpdate) parentUpdate('remove', node.id);
    else updateLayout({ type: 'pane', id: 'root', content: { widget: 'empty' } });
  };

  const handleChangeContent = (e) => {
    const type = e.target.value;
    const TargetWidget = widgets[type];

    // Always start with fresh id and widget type
    let newNode = {
      id: uuidv4(),
      widget: type
    };

    // Container widgets get children
    if (type === 'VerticalSplit' || type === 'HorizontalSplit') {
      newNode.children = [
        { id: uuidv4(), widget: 'Empty' },
        { id: uuidv4(), widget: 'Empty' }
      ];
    } else if (type === 'TabSet') {
      newNode.children = [
        { id: uuidv4(), widget: 'Empty' }
      ];
    } else {
      // Leaf widgets: merge in defaults if available
      if (TargetWidget.get_default && typeof TargetWidget.get_default === 'function') {
        const defaults = TargetWidget.get_default(data_context);
        newNode = { ...newNode, ...defaults };  // Merge, but id/widget remain fresh
      }
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

  const style = { opacity: isDragging ? 0.5 : 1 };

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
          {hasConfig && (
            <button className="btn btn-secondary me-1" onClick={handleConfigure}>
              <i className="fas fa-cog"></i>
            </button>
          )}
          <button className="btn btn-secondary me-1" onClick={handlePopout}><i className="fas fa-external-link-alt"></i></button>
          <button className="btn btn-danger" onClick={handleRemove}><i className="fas fa-times"></i></button>
        </div>
      </div>
      <div className="p-1 flex-grow-1 overflow-auto">
        <WidgetErrorBoundary widgetName={node.widget} node={node}>
          <Widget parentUpdate={parentUpdate} {...node} />
        </WidgetErrorBoundary>
      </div>

      {/* Configuration Modal */}
      <Modal show={showConfigModal} onHide={() => setShowConfigModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Configure {Widget.title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {hasConfig && (
            <CustomForm
              schema={Widget.get_schema(data_context)}
              formData={formData}
              validator={validator}
              onSubmit={handleConfigSubmit}
            >
              <div className="d-flex justify-content-end gap-2 mt-3">
                <Button variant="secondary" onClick={() => setShowConfigModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit">
                  Save Configuration
                </Button>
              </div>
            </CustomForm>
          )}
        </Modal.Body>
      </Modal>
    </div>
  );
}
