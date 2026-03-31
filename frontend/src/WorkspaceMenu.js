import React, { useContext, useEffect, useState, useRef } from 'react';
import { useRegisterMenu } from './flexout/MenuContext';
import { LayoutContext } from './flexout/LayoutContext';
import { ProcessContext } from './ProcessContext';
import { getWorkspaces, getWorkspace, saveWorkspace } from './datamodel/api';

function WorkspaceMenuItem({ workspace, updateLayout, setSelectedEnvironment, isActive }) {
  useRegisterMenu(
    ['Workspaces', workspace.title],
    async () => {
      try {
        const ws = await getWorkspace(workspace.id);
        updateLayout(ws.layout);
        setSelectedEnvironment(workspace.id);
      } catch (error) {
        console.error('Failed to load workspace:', error);
        alert('Failed to load workspace. Please try again.');
      }
    },
    10 + workspace.index,
    isActive
  );

  return null;
}

export default function WorkspaceMenu() {
  const { layout, updateLayout } = useContext(LayoutContext);
  const { selectedEnvironment, setSelectedEnvironment } = useContext(ProcessContext);
  const [workspaces, setWorkspaces] = useState([]);
  const layoutRef = useRef(layout);

  // Keep layoutRef up to date with current layout
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  // Load workspaces from server
  useEffect(() => {
    loadWorkspaces();
  }, []);

  const loadWorkspaces = async () => {
    try {
      const data = await getWorkspaces();
      setWorkspaces(data);
    } catch (error) {
      console.error('Failed to load workspaces:', error);
    }
  };

  // Register "Save Current Layout As..." menu item
  useRegisterMenu(
    ['Workspaces', 'Save Current Layout As...'],
    async () => {
      const title = window.prompt('Enter workspace name:');
      if (!title) return;

      try {
        // Use layoutRef.current to get the current layout value
        await saveWorkspace({
          title,
          layout: layoutRef.current,
        });
        await loadWorkspaces();
        alert(`Workspace "${title}" saved successfully!`);
      } catch (error) {
        console.error('Failed to save workspace:', error);
        alert('Failed to save workspace. Please try again.');
      }
    },
    1
  );

  return (
    <>
      {workspaces.map((ws, index) => (
        <WorkspaceMenuItem
          key={ws.id}
          workspace={{ ...ws, index }}
          updateLayout={updateLayout}
          setSelectedEnvironment={setSelectedEnvironment}
          isActive={ws.id === selectedEnvironment}
        />
      ))}
    </>
  );
}
