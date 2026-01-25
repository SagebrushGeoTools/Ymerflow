import React, { createContext, useContext, useState, useEffect } from "react";

const MenuContext = createContext();

export function useRegisterMenu(path, action, position = 1) {
  const { registerMenu } = useMenu();

  useEffect(() => {
    registerMenu(path, action, position);
  }, []);
}

export function useRegisterMenuComponent(path, component, position = 1) {
  const { registerMenuComponent } = useMenu();

  useEffect(() => {
    registerMenuComponent(path, component, position);
  }, []);
}

export function useMenu() {
  return useContext(MenuContext);
}

function mergeMenu(tree, path, action, position = 1) {
  // Deep clone the path we're modifying to avoid mutating shared references
  const newTree = { ...tree };
  let node = newTree;
  const nodePath = [];

  path.forEach((label, index) => {
    // Create a new copy of this node to avoid mutation
    if (!node[label]) {
      node[label] = { __children: {}, position };
    } else {
      // Clone existing node to avoid mutation
      node[label] = {
        ...node[label],
        __children: { ...node[label].__children }
      };
    }

    if (index === path.length - 1) {
      // Only set action if provided (allow null to skip)
      if (action !== null) {
        node[label].action = action;
      }
      node[label].position = position;
    }

    nodePath.push(node[label]);
    node = node[label].__children;
  });

  return newTree;
}

function mergeMenuComponent(tree, path, component, position = 1) {
  // Deep clone the path we're modifying to avoid mutating shared references
  const newTree = { ...tree };
  let node = newTree;

  path.forEach((label, index) => {
    // Create a new copy of this node to avoid mutation
    if (!node[label]) {
      node[label] = { __children: {}, position };
    } else {
      // Clone existing node to avoid mutation
      node[label] = {
        ...node[label],
        __children: { ...node[label].__children }
      };
    }

    if (index === path.length - 1) {
      // Only set component if provided (allow null to skip)
      if (component !== null) {
        node[label].component = component;
      }
      node[label].position = position;
    }

    node = node[label].__children;
  });

  return newTree;
}

export function MenuProvider({ children }) {
  const [menuTree, setMenuTree] = useState({});

  function registerMenu(path, action, position = 1) {
    setMenuTree(prev => mergeMenu({ ...prev }, path, action, position));
  }

  function registerMenuComponent(path, component, position = 1) {
    setMenuTree(prev => mergeMenuComponent({ ...prev }, path, component, position));
  }

  return (
    <MenuContext.Provider value={{ menuTree, registerMenu, registerMenuComponent }}>
      {children}
    </MenuContext.Provider>
  );
}
