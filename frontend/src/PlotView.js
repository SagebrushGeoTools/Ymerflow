import React, { useContext, useState, useEffect } from "react";
import Plot from "react-plotly.js";
import { useProcessOutputDatasets } from "./hooks/useQueries";
import { ProcessContext } from './ProcessContext';
import { getDatasetData } from './api';

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

export default function PlotView({ layoutConfig, ...props }) {
  const { activeProcess, processes, currentPart, setCurrentPart } = useContext(ProcessContext);

  // Find the actual process object from activeProcess
  const process = activeProcess ? processes.find(p => p.id === activeProcess.processId) : null;
  const version = activeProcess?.version;

  const { data: datasets = [], isLoading } = useProcessOutputDatasets(process, version);

  // State for fetched data
  const [fetchedData, setFetchedData] = useState({});
  const [dataLoading, setDataLoading] = useState(false);

  // Build list of available parts from datasets
  const availableParts = ["all"];
  datasets.forEach(dataset => {
    if (dataset.parts) {
      Object.keys(dataset.parts).forEach(partName => {
        const partPath = partName;
        if (!availableParts.includes(partPath)) {
          availableParts.push(partPath);
        }
        // TODO: Handle nested parts recursively if needed
      });
    }
  });

  // Fetch data for current part whenever it changes
  useEffect(() => {
    const fetchData = async () => {
      setDataLoading(true);
      const newFetchedData = {};

      for (const dataset of datasets) {
        try {
          const datasetId = dataset.id;
          const data = await getDatasetData(datasetId, currentPart);
          newFetchedData[dataset.dataset_name] = data;
        } catch (error) {
          console.error(`Failed to fetch data for ${dataset.dataset_name}:`, error);
        }
      }

      setFetchedData(newFetchedData);
      setDataLoading(false);
    };

    if (datasets.length > 0) {
      fetchData();
    }
  }, [datasets, currentPart]);

  // Use layoutConfig from props with fallback to default
  const config = layoutConfig || PlotView.get_default({ datasets }).layoutConfig;

  // Render all plotly traces
  const traces = [];
  config.subplots.forEach((subplot, i) => {
    subplot.elements.forEach(el => {
      const def = PLOT_ELEMENTS[el.type];
      const data = fetchedData[el.params.dataset];
      if (data) {
        traces.push(def.render({ params: el.params, dataset: data }));
      }
    });
  });

  return (
    <div className="h-100 d-flex flex-column">
      {/* Part selector dropdown */}
      <div className="p-2 border-bottom">
        <div className="d-flex align-items-center gap-2">
          <label className="form-label mb-0">Part:</label>
          <select
            className="form-select form-select-sm"
            value={currentPart}
            onChange={(e) => setCurrentPart(e.target.value)}
            style={{ width: 'auto', minWidth: '150px' }}
          >
            {availableParts.map(part => (
              <option key={part} value={part}>{part}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-grow-1">
        {isLoading || dataLoading ? (
          <div className="d-flex align-items-center justify-content-center h-100">
            {isLoading ? "Loading datasets..." : "Loading data..."}
          </div>
        ) : (
          <Plot
            data={traces}
            layout={{
              grid: { rows: config.rows, columns: config.cols, pattern: "independent" },
              autosize: true,
              title: "Process Outputs"
            }}
            useResizeHandler={true}
            style={{ width: "100%", height: "100%" }}
          />
        )}
      </div>
    </div>
  );
}

PlotView.title = "Plot view";

PlotView.get_schema = (data_context = {}) => {
  const datasets = data_context.datasets || [];
  const datasetNames = datasets.map(d => d.dataset_name);

  return {
    type: "object",
    properties: {
      id: {
        type: "string",
        title: "ID",
        readOnly: true
      },
      widget: {
        type: "string",
        title: "Widget Type",
        readOnly: true
      },
      layoutConfig: {
        type: "object",
        title: "Plot Layout Configuration",
        properties: {
          rows: {
            type: "integer",
            title: "Rows",
            default: 1,
            minimum: 1
          },
          cols: {
            type: "integer",
            title: "Columns",
            default: 1,
            minimum: 1
          },
          subplots: {
            type: "array",
            title: "Subplots",
            items: {
              type: "object",
              properties: {
                title: { type: "string", title: "Plot Title" },
                x_unit: { type: "string", title: "X-axis Unit" },
                y_unit: { type: "string", title: "Y-axis Unit" },
                elements: {
                  type: "array",
                  title: "Plot Elements",
                  items: {
                    type: "object",
                    properties: {
                      type: {
                        type: "string",
                        enum: ["Line", "Points"],
                        title: "Element Type"
                      },
                      params: {
                        type: "object",
                        title: "Parameters",
                        properties: {
                          dataset: datasetNames.length > 0
                            ? { type: "string", enum: datasetNames, title: "Dataset" }
                            : { type: "string", title: "Dataset" },
                          color: { type: "string", title: "Color" },
                          scale: { type: "number", title: "Scale" }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    required: ["layoutConfig"]
  };
};

PlotView.get_default = (data_context = {}) => {
  const datasets = data_context.datasets || [];
  const firstDataset = datasets.length > 0 ? datasets[0].dataset_name : "";

  return {
    layoutConfig: {
      rows: 1,
      cols: 1,
      subplots: [
        {
          title: "Plot 1",
          x_unit: "s",
          y_unit: "V",
          elements: firstDataset ? [
            {
              type: "Line",
              params: {
                dataset: firstDataset,
                color: "blue",
                scale: 1
              }
            }
          ] : []
        }
      ]
    }
  };
};
