# Flexout Layout System

The Flexout layout system provides a flexible, drag-and-drop interface for arranging widgets in the Nagelfluh frontend. It supports splits, tabs, and popout windows.

## Overview

Flexout is a custom-built layout engine located in `frontend/src/flexout/`. It manages a recursive tree structure where each node represents either:
- A **widget** (content pane)
- A **split** (vertical or horizontal container)
- A **tab set** (tabbed container)
- An **empty** placeholder

## Architecture

### Core Components

```
flexout/
├── LayoutContext.js       # State management, tree operations
├── MenuContext.js         # Menu registration system
├── Layout.js              # MainLayout and PopoutWrapper
├── MenuBar.js             # Top menu bar
└── components/
    ├── Pane.js            # Individual widget pane
    ├── Split.js           # Resizable split container
    ├── TabSet.js          # Tabbed container
    └── Empty.js           # Empty placeholder
```

### Layout Tree Structure

```javascript
{
  id: "root",
  widget: "VerticalSplit",
  children: [
    {
      id: "left-pane",
      widget: "FlowView"
    },
    {
      id: "right-split",
      widget: "HorizontalSplit",
      children: [
        {
          id: "top-right",
          widget: "ProcessEditor"
        },
        {
          id: "bottom-right",
          widget: "TabSet",
          children: [
            { id: "tab-1", widget: "PlotView" },
            { id: "tab-2", widget: "MapView" }
          ]
        }
      ]
    }
  ]
}
```

## LayoutContext

The `LayoutContext` provides global state and operations for the layout tree.

### Provider Setup

```javascript
// App.js
import { LayoutProvider } from './flexout/LayoutContext';

const widgets = {
  FlowView,
  ProcessEditor,
  PlotView,
  // ... other widgets
};

function App() {
  return (
    <LayoutProvider widgets={widgets}>
      {/* App content */}
    </LayoutProvider>
  );
}
```

### Context API

```javascript
import { useLayoutContext } from './flexout/LayoutContext';

function MyComponent() {
  const {
    layout,              // Current layout tree
    setLayout,           // Set entire layout tree
    widgets,             // Available widget types
    getNode,             // Get node by ID
    updateNode,          // Update node data
    removeNode,          // Remove node from tree
    replaceNode,         // Replace node with another
    splitNode,           // Split node into two panes
    addTab,              // Add tab to TabSet
    popoutNode,          // Popout node to new window
  } = useLayoutContext();
}
```

### Tree Operations

#### Get Node

```javascript
const node = getNode("pane-123");
// Returns: { id: "pane-123", widget: "PlotView", data: {...} }
```

#### Update Node

```javascript
updateNode("pane-123", {
  widget: "ProcessEditor",  // Change widget type
  data: { /* custom data */ }
});
```

#### Remove Node

```javascript
removeNode("pane-123");
// Removes node and rebalances tree
```

#### Split Node

```javascript
splitNode("pane-123", "horizontal", {
  id: "new-pane",
  widget: "MapView"
});
// Creates horizontal split with existing pane and new pane
```

#### Add Tab

```javascript
addTab("tabset-456", {
  id: "new-tab",
  widget: "PlotView"
});
// Adds new tab to existing TabSet
```

#### Popout Node

```javascript
popoutNode("pane-123");
// Opens node in new browser window
```

## Built-in Widget Types

### VerticalSplit / HorizontalSplit

Resizable split containers with draggable divider.

**Properties:**
```javascript
{
  id: "split-1",
  widget: "VerticalSplit",  // or "HorizontalSplit"
  children: [
    { id: "left", widget: "FlowView" },
    { id: "right", widget: "PlotView" }
  ],
  data: {
    splitPercent: 50  // Initial split position (0-100)
  }
}
```

**Features:**
- Drag divider to resize
- Stores split position in node data
- Collapses to single pane if one child is removed
- Minimum pane size: 100px

**Implementation:**

```javascript
// Split.js
function Split({ node, vertical }) {
  const [splitPercent, setSplitPercent] = useState(node.data?.splitPercent || 50);

  const handleDrag = (e) => {
    const newPercent = calculatePercent(e);
    setSplitPercent(newPercent);
    updateNode(node.id, {
      data: { ...node.data, splitPercent: newPercent }
    });
  };

  return (
    <div className={vertical ? "vertical-split" : "horizontal-split"}>
      <div style={{ [vertical ? 'width' : 'height']: `${splitPercent}%` }}>
        {renderChild(node.children[0])}
      </div>
      <div className="divider" onMouseDown={startDrag} />
      <div style={{ [vertical ? 'width' : 'height']: `${100 - splitPercent}%` }}>
        {renderChild(node.children[1])}
      </div>
    </div>
  );
}
```

### TabSet

Tabbed container for multiple widgets.

**Properties:**
```javascript
{
  id: "tabs-1",
  widget: "TabSet",
  children: [
    { id: "tab-1", widget: "PlotView" },
    { id: "tab-2", widget: "MapView" },
    { id: "tab-3", widget: "ProcessLog" }
  ],
  data: {
    activeTab: "tab-2"  // Currently selected tab
  }
}
```

**Features:**
- Click tab to switch active widget
- Drag tab to reorder
- Close button on each tab
- Drag tab out to create new split
- Add new tab via + button

**Implementation:**

```javascript
// TabSet.js
function TabSet({ node }) {
  const [activeTab, setActiveTab] = useState(node.data?.activeTab || node.children[0]?.id);

  const handleTabClick = (tabId) => {
    setActiveTab(tabId);
    updateNode(node.id, {
      data: { ...node.data, activeTab: tabId }
    });
  };

  return (
    <div className="tabset">
      <div className="tab-bar">
        {node.children.map(child => (
          <div
            key={child.id}
            className={activeTab === child.id ? 'tab active' : 'tab'}
            onClick={() => handleTabClick(child.id)}
          >
            {widgets[child.widget]?.title || child.widget}
            <button onClick={(e) => { e.stopPropagation(); removeNode(child.id); }}>×</button>
          </div>
        ))}
        <button className="add-tab" onClick={handleAddTab}>+</button>
      </div>
      <div className="tab-content">
        {renderChild(node.children.find(c => c.id === activeTab))}
      </div>
    </div>
  );
}
```

### Empty

Placeholder for empty panes.

**Properties:**
```javascript
{
  id: "empty-1",
  widget: "Empty"
}
```

**Features:**
- Shows "Empty pane" message
- Dropdown to select widget type
- Automatically removed when parent Split has one child

### Pane

Wrapper component for all widgets.

**Features:**
- Header with widget title
- Dropdown to change widget type
- Popout button
- Close button
- Drag-and-drop support

**Implementation:**

```javascript
// Pane.js
function Pane({ node }) {
  const { widgets, updateNode, removeNode, popoutNode } = useLayoutContext();
  const WidgetComponent = widgets[node.widget];

  return (
    <div className="pane">
      <div className="pane-header">
        <span className="title">{WidgetComponent?.title || node.widget}</span>
        <select
          value={node.widget}
          onChange={(e) => updateNode(node.id, { widget: e.target.value })}
        >
          {Object.keys(widgets).map(widgetType => (
            <option key={widgetType} value={widgetType}>
              {widgets[widgetType]?.title || widgetType}
            </option>
          ))}
        </select>
        <button onClick={() => popoutNode(node.id)}>⧉</button>
        <button onClick={() => removeNode(node.id)}>×</button>
      </div>
      <div className="pane-content">
        {WidgetComponent && <WidgetComponent nodeId={node.id} />}
      </div>
    </div>
  );
}
```

## Drag and Drop

Flexout uses `react-dnd` for drag-and-drop functionality.

### Drop Zones

Each pane has four drop zones:
- **Top**: Creates horizontal split with new pane on top
- **Bottom**: Creates horizontal split with new pane on bottom
- **Left**: Creates vertical split with new pane on left
- **Right**: Creates vertical split with new pane on right
- **Center**: Replaces current pane or adds to TabSet

### Drag Sources

- **Tabs**: Can be dragged from TabSets
- **Panes**: Can be dragged by header
- **Widgets**: Can be dragged from sidebar/menu

### Implementation

```javascript
import { useDrag, useDrop } from 'react-dnd';

function Pane({ node }) {
  const [{ isDragging }, drag] = useDrag({
    type: 'PANE',
    item: { id: node.id, widget: node.widget },
    collect: monitor => ({ isDragging: monitor.isDragging() })
  });

  const [{ isOver, dropPosition }, drop] = useDrop({
    accept: 'PANE',
    drop: (item, monitor) => {
      const dropZone = calculateDropZone(monitor.getClientOffset());
      handleDrop(item, node.id, dropZone);
    },
    collect: monitor => ({
      isOver: monitor.isOver(),
      dropPosition: calculateDropZone(monitor.getClientOffset())
    })
  });

  return (
    <div ref={drop}>
      <div ref={drag} className="pane-header">
        {/* ... */}
      </div>
      {isOver && <DropIndicator position={dropPosition} />}
      {/* ... */}
    </div>
  );
}
```

## Popout Windows

Panes can be popped out to separate browser windows using `window.open()`.

### Popout Mechanism

```javascript
// LayoutContext.js
function popoutNode(nodeId) {
  const node = getNode(nodeId);

  // Open new window
  const popoutWindow = window.open(
    `/popout/${nodeId}`,
    `popout-${nodeId}`,
    'width=800,height=600'
  );

  // Remove from main layout
  removeNode(nodeId);

  // Store reference for communication
  popoutWindows.set(nodeId, { window: popoutWindow, node });
}
```

### Popout Component

```javascript
// PopoutWrapper.js (rendered at /popout/:id route)
function PopoutWrapper() {
  const { id } = useParams();
  const { getNode, widgets } = useLayoutContext();
  const node = getNode(id);
  const WidgetComponent = widgets[node.widget];

  useEffect(() => {
    // Set window title
    document.title = WidgetComponent?.title || node.widget;

    // Cleanup on close
    return () => {
      window.opener?.postMessage({ type: 'popout-closed', id }, '*');
    };
  }, []);

  return <WidgetComponent nodeId={id} />;
}
```

### Communication

Popout windows communicate with main window via `postMessage`:

```javascript
// Main window
window.addEventListener('message', (event) => {
  if (event.data.type === 'popout-closed') {
    popoutWindows.delete(event.data.id);
  }
});

// Popout window
window.opener.postMessage({
  type: 'widget-action',
  nodeId: id,
  action: 'update',
  data: { /* ... */ }
}, '*');
```

## Menu System

The MenuContext provides a registration system for global menus.

### MenuContext API

```javascript
import { useMenuContext } from './flexout/MenuContext';

function MyComponent() {
  const { registerMenu, unregisterMenu } = useMenuContext();

  useEffect(() => {
    registerMenu('File', [
      { label: 'New', onClick: handleNew, shortcut: 'Ctrl+N' },
      { label: 'Open', onClick: handleOpen, shortcut: 'Ctrl+O' },
      { type: 'separator' },
      { label: 'Exit', onClick: handleExit }
    ]);

    return () => unregisterMenu('File');
  }, []);
}
```

### Menu Structure

```javascript
{
  'File': [
    { label: 'New', onClick: () => {}, shortcut: 'Ctrl+N' },
    { label: 'Open', onClick: () => {}, shortcut: 'Ctrl+O' },
    { type: 'separator' },
    { label: 'Exit', onClick: () => {} }
  ],
  'Edit': [
    { label: 'Undo', onClick: () => {}, shortcut: 'Ctrl+Z' },
    { label: 'Redo', onClick: () => {}, shortcut: 'Ctrl+Y' }
  ]
}
```

## Persistence

Layout state can be persisted to localStorage or backend.

### Save Layout

```javascript
function saveLayout() {
  const { layout } = useLayoutContext();
  localStorage.setItem('nagelfluh-layout', JSON.stringify(layout));
}
```

### Load Layout

```javascript
function loadLayout() {
  const { setLayout } = useLayoutContext();
  const saved = localStorage.getItem('nagelfluh-layout');
  if (saved) {
    setLayout(JSON.parse(saved));
  }
}
```

### Default Layout

```javascript
const DEFAULT_LAYOUT = {
  id: "root",
  widget: "VerticalSplit",
  children: [
    { id: "flow", widget: "FlowView" },
    {
      id: "right",
      widget: "HorizontalSplit",
      children: [
        { id: "editor", widget: "ProcessEditor" },
        { id: "log", widget: "ProcessLog" }
      ]
    }
  ]
};
```

## Best Practices

### Tree Manipulation

**✅ DO**: Use provided context methods

```javascript
const { splitNode, addTab, removeNode } = useLayoutContext();
splitNode(nodeId, 'vertical', newNode);
```

**❌ DON'T**: Directly mutate layout tree

```javascript
// ❌ Wrong!
layout.children.push(newNode);
setLayout(layout);
```

### Node IDs

**✅ DO**: Generate unique IDs

```javascript
import { v4 as uuidv4 } from 'uuid';
const newNode = { id: uuidv4(), widget: 'PlotView' };
```

**❌ DON'T**: Reuse IDs

```javascript
// ❌ Wrong! May cause conflicts
const newNode = { id: 'plot-1', widget: 'PlotView' };
```

### Widget Data

**✅ DO**: Store widget-specific config in node.data

```javascript
updateNode(nodeId, {
  data: {
    plotElements: [...],
    selectedDataset: '...'
  }
});
```

**❌ DON'T**: Store in widget component state if persistence is needed

```javascript
// ❌ Lost on widget unmount
const [config, setConfig] = useState({});
```

## Advanced Customization

### Custom Layout Widgets

You can create custom layout widgets beyond Split/TabSet:

```javascript
// GridLayout.js
function GridLayout({ node }) {
  return (
    <div className="grid-layout">
      {node.children.map(child => (
        <div key={child.id} className="grid-item">
          {renderChild(child)}
        </div>
      ))}
    </div>
  );
}

GridLayout.title = "Grid Layout";

// Register as widget
const widgets = {
  // ...
  GridLayout
};
```

### Custom Drop Behaviors

Override drop handling for specific widgets:

```javascript
function CustomPane({ node }) {
  const [, drop] = useDrop({
    accept: 'PANE',
    drop: (item) => {
      // Custom drop logic
      if (item.type === 'special') {
        handleSpecialDrop(item);
      } else {
        defaultDropHandler(item);
      }
    }
  });

  return <div ref={drop}>{/* ... */}</div>;
}
```
