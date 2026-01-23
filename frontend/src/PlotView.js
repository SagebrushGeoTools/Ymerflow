import React, { useContext, useState, useEffect } from "react";
import Plot from "react-plotly.js";
import { useProcessOutputDatasets } from "./hooks/useQueries";
import { ProcessContext } from './ProcessContext';
import { loadDataset } from './dataset';

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
  },
  FlightlinePlot: {
    parameters: {
      dataset: { type: "string" },
      x_column: { type: "string", default: "lon" },
      y_column: { type: "string", default: "lat" },
      mode: { type: "string", enum: ["lines", "markers", "lines+markers"], default: "markers" },
      color: { type: "string", default: "blue" }
    },
    render: ({ params, dataset }) => {
      console.log("FlightlinePlot render called with:", { params, dataset });

      // Handle XYZ dataset object
      const flightlines = dataset?.flightlines;

      if (flightlines) {
        console.log("Flightlines found:", flightlines);
        console.log("Available columns:", Object.keys(flightlines));

        const x = flightlines[params.x_column];
        const y = flightlines[params.y_column];

        console.log("X data:", x, "type:", x?.constructor?.name);
        console.log("Y data:", y, "type:", y?.constructor?.name);

        if (!x || !y) {
          console.warn(`Column not found: ${params.x_column} or ${params.y_column}`);
          return null;
        }

        const trace = {
          x: Array.from(x),  // Convert TypedArray to regular array
          y: Array.from(y),
          type: "scatter",
          mode: params.mode,
          name: `${params.dataset}: ${params.y_column} vs ${params.x_column}`,
          line: params.mode.includes("lines") ? { color: params.color } : undefined,
          marker: params.mode.includes("markers") ? { color: params.color } : undefined
        };

        console.log("Generated trace:", trace);
        return trace;
      }

      console.warn("Dataset has no flightlines property:", dataset);
      return null;
    }
  }
};

export default function PlotView({ layoutConfig, ...props }) {
  const { activeProcess, processes, currentPart } = useContext(ProcessContext);

  // Find the actual process object from activeProcess
  const process = activeProcess ? processes.find(p => p.id === activeProcess.processId) : null;
  const version = activeProcess?.version;

  const { data: datasets = [], isLoading } = useProcessOutputDatasets(process, version);

  // State for fetched data and dataset objects
  const [fetchedData, setFetchedData] = useState({});
  const [datasetObjects, setDatasetObjects] = useState({});
  const [dataLoading, setDataLoading] = useState(false);

  // Load dataset objects
  useEffect(() => {
    const loadDatasets = async () => {
      const newDatasetObjects = {};

      for (const dataset of datasets) {
        try {
          const datasetObj = await loadDataset(dataset.id);
          newDatasetObjects[dataset.dataset_name] = datasetObj;
        } catch (error) {
          console.error(`Failed to load dataset ${dataset.dataset_name}:`, error);
        }
      }

      setDatasetObjects(newDatasetObjects);
    };

    if (datasets.length > 0) {
      loadDatasets();
    }
  }, [datasets]);

  // Fetch data for current part whenever it changes
  useEffect(() => {
    const fetchData = async () => {
      setDataLoading(true);
      const newFetchedData = {};

      for (const [datasetName, datasetObj] of Object.entries(datasetObjects)) {
        try {
          const data = await datasetObj.getData(currentPart);
          newFetchedData[datasetName] = data;
        } catch (error) {
          console.error(`Failed to fetch data for ${datasetName}:`, error);
        }
      }

      setFetchedData(newFetchedData);
      setDataLoading(false);
    };

    if (Object.keys(datasetObjects).length > 0) {
      fetchData();
    }
  }, [datasetObjects, currentPart]);

  // Use layoutConfig from props with fallback to default
  const config = layoutConfig || PlotView.get_default({ datasets }).layoutConfig;

  // Render all plotly traces
  const traces = [];
  if (config.elements) {
    config.elements.forEach(el => {
      const def = PLOT_ELEMENTS[el.type];
      const data = fetchedData[el.params.dataset];
      if (data && def) {
        const trace = def.render({ params: el.params, dataset: data });
        if (trace) {
          traces.push(trace);
        }
      }
    });
  }

  return (
    <div className="h-100 d-flex flex-column">
      <div className="flex-grow-1">
        {isLoading || dataLoading ? (
          <div className="d-flex align-items-center justify-content-center h-100">
            {isLoading ? "Loading datasets..." : "Loading data..."}
          </div>
        ) : (
          <Plot
            data={traces}
            layout={{
              autosize: true,
              title: config.title || "Process Outputs",
              xaxis: { title: config.x_unit || "" },
              yaxis: { title: config.y_unit || "" }
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
        title: "Plot Configuration",
        properties: {
          title: {
            type: "string",
            title: "Plot Title",
            default: "Process Outputs"
          },
          x_unit: {
            type: "string",
            title: "X-axis Unit",
            default: "s"
          },
          y_unit: {
            type: "string",
            title: "Y-axis Unit",
            default: "V"
          },
          elements: {
            type: "array",
            title: "Plot Elements",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["Line", "Points", "FlightlinePlot"],
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
                    scale: { type: "number", title: "Scale" },
                    x_column: { type: "string", title: "X Column", default: "lon" },
                    y_column: { type: "string", title: "Y Column", default: "lat" },
                    mode: {
                      type: "string",
                      enum: ["lines", "markers", "lines+markers"],
                      title: "Mode",
                      default: "markers"
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
      title: "Process Outputs",
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
  };
};
