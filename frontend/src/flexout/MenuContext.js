import React, { createContext, useContext, useState, useEffect } from "react";

const MenuContext = createContext();

export function useRegisterMenu(path, action) {
  const { registerMenu } = useMenu();

  useEffect(() => {
    registerMenu(path, action);
  }, []);
}

export function useRegisterMenuComponent(path, component) {
  const { registerMenuComponent } = useMenu();

  useEffect(() => {
    registerMenuComponent(path, component);
  }, []);
}

export function useMenu() {
  return useContext(MenuContext);
}

function mergeMenu(tree, path, action) {
  let node = tree;

  path.forEach((label, index) => {
    if (!node[label]) {
      node[label] = { __children: {} };
    }

    if (index === path.length - 1) {
      node[label].action = action;
    }

    node = node[label].__children;
  });

  return { ...tree };
}

function mergeMenuComponent(tree, path, component) {
  let node = tree;

  path.forEach((label, index) => {
    if (!node[label]) {
      node[label] = { __children: {} };
    }

    if (index === path.length - 1) {
      node[label].component = component;
    }

    node = node[label].__children;
  });

  return { ...tree };
}

export function MenuProvider({ children }) {
  const [menuTree, setMenuTree] = useState({});

  function registerMenu(path, action) {
    setMenuTree(prev => mergeMenu({ ...prev }, path, action));
  }

  function registerMenuComponent(path, component) {
    setMenuTree(prev => mergeMenuComponent({ ...prev }, path, component));
  }

  return (
    <MenuContext.Provider value={{ menuTree, registerMenu, registerMenuComponent }}>
      {children}
    </MenuContext.Provider>
  );
}
