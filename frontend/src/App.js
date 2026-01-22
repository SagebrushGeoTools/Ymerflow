import React, { useEffect, useState, useContext } from 'react';
import { Routes, Route, useParams } from 'react-router-dom';
import { LayoutProvider } from './flexout/LayoutContext';
import { MainLayout, PopoutWrapper } from './flexout/Layout';
import { ProcessProvider, ProcessContext } from './ProcessContext';
import { MenuProvider } from "./flexout/MenuContext";
import MenuBar from "./flexout/MenuBar";
import { getProcessOutputDatasets } from "./api";

import ProcessEditor from "./ProcessEditor";
import FlowView from "./FlowView";
import PlotView from "./PlotView";

var widgets = {
  PlotView: PlotView,
  FlowView: FlowView,
  ProcessEditor: ProcessEditor,
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

function AppWithContext() {
  const { activeProcess } = useContext(ProcessContext);
  const [datasets, setDatasets] = useState([]);

  useEffect(() => {
    if (activeProcess) {
      getProcessOutputDatasets(activeProcess).then(datasets => {
        setDatasets(datasets);
      });
    } else {
      setDatasets([]);
    }
  }, [activeProcess]);

  const data_context = {
    activeProcess,
    datasets
  };

  return (
    <LayoutProvider widgets={widgets} initial_layout={initial_layout} data_context={data_context}>
      <MenuProvider>
        <Routes>
          <Route path="/" element={<><MenuBar /> <MainLayout /></>} />
          <Route path="/popout/:id" element={<PopoutWrapper />} />
        </Routes>
      </MenuProvider>
    </LayoutProvider>
  );
}

export default function App() {
  return (
    <ProcessProvider>
      <AppWithContext />
    </ProcessProvider>
  );
}
