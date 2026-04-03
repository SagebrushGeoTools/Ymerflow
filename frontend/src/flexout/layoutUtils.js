// Find all paths to nodes of a given widget type.
// A path is an array of node IDs from root to target (inclusive).
// When a TabSet is on the path, the next ID is the active tab child.
export function findWidgetPaths(node, widgetType, currentPath = []) {
  const path = [...currentPath, node.id];
  if (node.widget === widgetType) return [path];
  if (!node.children) return [];
  return node.children.flatMap(child => findWidgetPaths(child, widgetType, path));
}

// Walk the layout tree and, for every TabSet whose ID appears in path,
// set its activeTab to the following ID in the path.
// Returns a new layout tree with those activeTab values updated.
function applyPathToNode(node, path) {
  const idx = path.indexOf(node.id);
  if (idx === -1) return node;

  let result = node;

  if (node.widget === 'TabSet' && idx + 1 < path.length) {
    result = { ...result, activeTab: path[idx + 1] };
  }

  if (result.children) {
    result = {
      ...result,
      children: result.children.map(child => applyPathToNode(child, path)),
    };
  }

  return result;
}

export function applyPath(layout, path) {
  return applyPathToNode(layout, path);
}
