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
  let node = tree;

  path.forEach((label, index) => {
    if (!node[label]) {
      node[label] = { __children: {}, position };
    }

    if (index === path.length - 1) {
      node[label].action = action;
      node[label].position = position;
    }

    node = node[label].__children;
  });

  return { ...tree };
}

function mergeMenuComponent(tree, path, component, position = 1) {
  let node = tree;

  path.forEach((label, index) => {
    if (!node[label]) {
      node[label] = { __children: {}, position };
    }

    if (index === path.length - 1) {
      node[label].component = component;
      node[label].position = position;
    }

    node = node[label].__children;
  });

  return { ...tree };
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
