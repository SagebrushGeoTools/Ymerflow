import React, { useEffect, useState, useContext } from "react";
import Plot from "react-plotly.js";
import { getDatasets } from "./api";
import { Button, Form } from "react-bootstrap";
import { ProcessContext } from './ProcessContext';

/**
 * Example plot elements registry
 * Each element has:
 * - name
 * - x_unit, y_unit
 * - parameters (with schema)
 * - render: function({params, dataset}) => {x, y}
 */
const PLOT_ELEMENTS = {
  Line: {
    x_unit: "s",
    y_unit: "V",
    parameters: {
      color: { type: "string", default: "blue" },
      scale: { type: "number", default: 1 },
      dataset: { type: "string" }
    },
    render: ({ params, dataset }) => ({
      x: dataset.x,
      y: dataset.y.map(v => v * params.scale),
      type: "scatter",
      mode: "lines",
      name: params.dataset,
      line: { color: params.color }
    })
  },
  Points: {
    x_unit: "s",
    y_unit: "V",
    parameters: {
      color: { type: "string", default: "red" },
      dataset: { type: "string" }
    },
    render: ({ params, dataset }) => ({
      x: dataset.x,
      y: dataset.y,
      type: "scatter",
      mode: "markers",
      name: params.dataset,
      marker: { color: params.color }
    })
  }
};

export default function PlotView({ }) {
  const {
    processes, setProcesses, activeProcess, setActiveProcess
  } =  useContext(ProcessContext);

  const [datasets, setDatasets] = useState([]);
  const [layoutConfig, setLayoutConfig] = useState({
    rows: 1,
    cols: 1,
    subplots: [
      {
        title: "Plot 1",
        x_unit: "s",
        y_unit: "V",
        elements: []
      }
    ]
  });
  const [selectedElementType, setSelectedElementType] = useState("");
  const [selectedDataset, setSelectedDataset] = useState("");

  // Load datasets for the process
  useEffect(() => {
    if (activeProcess) {
      getDatasets(activeProcess.id).then(ds => {
        setDatasets([ds]);
      });
    }
  }, [activeProcess]);

  // Add new plot element to first subplot
  const addPlotElement = () => {
    if (!selectedElementType || !selectedDataset) return;
    const elementDef = PLOT_ELEMENTS[selectedElementType];
    const dataset = datasets.find(d => d.name === selectedDataset);
    if (!dataset) return;
    // Check axis unit matching
    if (dataset.x_unit !== elementDef.x_unit || dataset.y_unit !== elementDef.y_unit) {
      alert("Axis units do not match!");
      return;
    }
    const newElement = {
      type: selectedElementType,
      params: {
        dataset: selectedDataset,
        ...Object.fromEntries(
          Object.entries(elementDef.parameters)
            .filter(([k]) => k !== "dataset")
            .map(([k, v]) => [k, v.default])
        )
      }
    };
    setLayoutConfig(prev => {
      const newLayout = { ...prev };
      newLayout.subplots[0].elements.push(newElement);
      return newLayout;
    });
  };

  // Render all plotly traces
  const traces = [];
  layoutConfig.subplots.forEach((subplot, i) => {
    subplot.elements.forEach(el => {
      const def = PLOT_ELEMENTS[el.type];
      const dataset = datasets.find(d => d.name === el.params.dataset);
      if (dataset) {
        traces.push(def.render({ params: el.params, dataset }));
      }
    });
  });

  return (
    <div className="h-100 d-flex flex-column">
      <div className="mb-2 border-bottom pb-2">
        <Form className="d-flex gap-2 align-items-end">
          <Form.Group>
            <Form.Label>Plot Element</Form.Label>
            <Form.Select
              value={selectedElementType}
              onChange={e => setSelectedElementType(e.target.value)}
            >
              <option value="">Select type</option>
              {Object.keys(PLOT_ELEMENTS).map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Form.Select>
          </Form.Group>

          <Form.Group>
            <Form.Label>Dataset</Form.Label>
            <Form.Select
              value={selectedDataset}
              onChange={e => setSelectedDataset(e.target.value)}
            >
              <option value="">Select dataset</option>
              {datasets.map(d => (
                <option key={d.name} value={d.name}>{d.name}</option>
              ))}
            </Form.Select>
          </Form.Group>

          <Button onClick={addPlotElement} variant="primary" className="mt-4">Add</Button>
        </Form>
      </div>

      <div className="flex-grow-1">
        <Plot
          data={traces}
          layout={{
            grid: { rows: layoutConfig.rows, columns: layoutConfig.cols, pattern: "independent" },
            autosize: true,
            title: "Process Outputs"
          }}
          useResizeHandler={true}
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
}
