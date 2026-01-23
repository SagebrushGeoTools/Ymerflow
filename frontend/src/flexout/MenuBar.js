import React from "react";
import { useMenu } from "./MenuContext";

function renderMenuItems(tree, depth = 0) {
  return Object.entries(tree).map(([label, node]) => {
    const hasChildren = Object.keys(node.__children).length > 0;

    // If this node has a component, render it
    if (node.component) {
      const Component = node.component;
      return (
        <li key={label}>
          <Component />
        </li>
      );
    }

    if (!hasChildren) {
      return (
        <li key={label}>
          <button className="dropdown-item" onClick={node.action}>
            {label}
          </button>
        </li>
      );
    }

    return (
      <li className="dropdown-submenu" key={label}>
        <button className="dropdown-item dropdown-toggle">
          {label}
        </button>
        <ul className="dropdown-menu">
          {renderMenuItems(node.__children, depth + 1)}
        </ul>
      </li>
    );
  });
}

export default function MenuBar({}) {
  const { menuTree } = useMenu();
  console.log("Menu tree", menuTree);
  return (
    <nav className="bg-dark navbar navbar-expand-lg navbar-dark">
      <ul className="navbar-nav me-auto mb-2 mb-lg-0">
        {Object.entries(menuTree).map(([label, node]) => {
          // If this top-level node has a component, render it directly
          if (node.component) {
            const Component = node.component;
            return (
              <li className="nav-item" key={label}>
                <Component />
              </li>
            );
          }

          // Otherwise render as a dropdown menu
          return (
            <li className="nav-item dropdown" key={label}>
              <button
                className="nav-link dropdown-toggle"
                data-bs-toggle="dropdown"
              >
                {label}
              </button>
              <ul className="dropdown-menu">
                {renderMenuItems(node.__children)}
              </ul>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
