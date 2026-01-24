import React, { useEffect, useState, useContext } from 'react';
import { Routes, Route, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LayoutProvider } from './flexout/LayoutContext';
import { MainLayout, PopoutWrapper } from './flexout/Layout';
import { ProcessProvider, ProcessContext } from './ProcessContext';
import { AuthProvider, AuthContext } from './AuthContext';
import { MenuProvider, useRegisterMenuComponent } from "./flexout/MenuContext";
import MenuBar from "./flexout/MenuBar";
import ProcessSelector from "./ProcessSelector";
import ProjectDropdown from "./ProjectDropdown";
import UserMenu from "./UserMenu";
import LandingPage from "./LandingPage";
import AccountPage from "./AccountPage";

import ProcessEditor from "./widgets/ProcessEditor";
import FlowView from "./widgets/FlowView";
import PlotView from "./widgets/PlotView";
import MapView from "./widgets/MapView";
import EnvironmentView from "./widgets/EnvironmentView";

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

var widgets = {
  PlotView: PlotView,
  MapView: MapView,
  FlowView: FlowView,
  ProcessEditor: ProcessEditor,
  EnvironmentView: EnvironmentView,
};

var initial_layout = {
    "splitType": "vertical",
    "id": "root",
    "widget": "VerticalSplit",
    "children": [
        {
            "id": "35501582-95b5-458e-b8ca-3a2b63413eac",
            "widget": "FlowView"
        },
        {
            "id": "794e8232-a793-4ff6-9372-3c94169a3eac",
            "widget": "TabSet",
            "children": [
                {
                    "id": "8658b5f1-d171-49b0-8dd9-73e46b469e5d",
                    "widget": "ProcessEditor"
                },
                {
                    "id": "d1e9273c-c3ca-4261-b14a-55cc0e45f583",
                    "widget": "PlotView"
                }
            ]
        }
    ]
};

function AppLogo() {
  return (
    <span className="navbar-brand">Nagelfluh Geophysics</span>
  );
}

function MenuBarWithComponents() {
  useRegisterMenuComponent(["_logo"], AppLogo, 0);
  useRegisterMenuComponent(["_projectDropdown"], ProjectDropdown, -2);
  useRegisterMenuComponent(["_processSelector"], ProcessSelector, -1);
  useRegisterMenuComponent(["_userMenu"], UserMenu, -3);

  return <MenuBar />;
}

function AppWithContext() {
  const processContext = useContext(ProcessContext);

  return (
    <LayoutProvider widgets={widgets} initial_layout={initial_layout} data_context={processContext}>
      <MenuProvider>
        <Routes>
          <Route path="/" element={
            <div className="d-flex flex-column h-100">
              <MenuBarWithComponents />
              <div className="flex-grow-1 overflow-hidden">
                <MainLayout />
              </div>
            </div>
          } />
          <Route path="/account" element={
            <div className="d-flex flex-column h-100">
              <MenuBarWithComponents />
              <div className="flex-grow-1 overflow-auto">
                <AccountPage />
              </div>
            </div>
          } />
          <Route path="/popout/:id" element={<PopoutWrapper />} />
        </Routes>
      </MenuProvider>
    </LayoutProvider>
  );
}

function AuthenticatedApp() {
  const { isAuthenticated } = useContext(AuthContext);

  if (!isAuthenticated) {
    return <LandingPage />;
  }

  return <AppWithContext />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ProcessProvider>
          <AuthenticatedApp />
        </ProcessProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
