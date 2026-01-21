import React, { useEffect, useState, useContext } from 'react';
import { Routes, Route, useParams } from 'react-router-dom';
import { LayoutProvider } from './flexout/LayoutContext';
import { MainLayout, PopoutWrapper } from './flexout/Layout';
import { ProcessProvider, ProcessContext } from './ProcessContext';

import ProcessEditor from "./ProcessEditor";
import FlowView from "./FlowView";
import PlotView from "./PlotView";
import CreateProcessModal from "./CreateProcessModal";

function Toolbar() {
  const {processes, setProcesses, activeProcess, setActiveProcess} =  useContext(ProcessContext);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <>
      <div className="row bg-dark text-light p-2 align-items-center">
        <div className="col">
          <h5 className="mb-0">Geophysical Processing & Inversion</h5>
        </div>
        <div className="col-auto">
          <button
            className="btn btn-success"
            onClick={() => setShowCreate(true)}
          >
            + New Process
          </button>
        </div>
      </div>
      
      <CreateProcessModal
        show={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={p => setProcesses(prev => [...prev, p])}
      />
    </>
  );
}

var widgets = {
  PlotView: PlotView,
  FlowView: FlowView,
  ProcessEditor: ProcessEditor,
  Toolbar: Toolbar,
  ClockWidget: () => <div>🕒 A simple clock</div>,
  SampleWidget: () => <div>📦 Just a package for you</div>,
  NotesWidget: () => <div>📝 Some notes</div>,
};




export default function App() {  
  return (
    <ProcessProvider>
      <LayoutProvider widgets={widgets}>
        <Routes>
          <Route path="/" element={<MainLayout />} />
          <Route path="/popout/:id" element={<PopoutWrapper />} />
        </Routes>
      </LayoutProvider>
    </ProcessProvider>
  );
}
