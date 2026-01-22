import React from "react";
import { useMenu } from "./MenuContext";

function renderMenuItems(tree, depth = 0) {
  return Object.entries(tree).map(([label, node]) => {
    const hasChildren = Object.keys(node.__children).length > 0;

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
        {Object.entries(menuTree).map(([label, node]) => (
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
        ))}
      </ul>
    </nav>
  );
}
