import React, { useContext, useState, useEffect } from "react";
import Plot from "react-plotly.js";
import { useProcessOutputDatasets } from "../../datamodel/useQueries";
import { ProcessContext } from '../../ProcessContext';
import { loadDataset } from '../../datamodel/dataset';
import PLOT_ELEMENTS from './elements';

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
        const result = def.render({ params: el.params, dataset: data });
        if (result) {
          // Handle both single trace and array of traces
          if (Array.isArray(result)) {
            traces.push(...result);
          } else {
            traces.push(result);
          }
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
              yaxis: {
                title: config.y_unit || "",
                type: config.y_scale || "linear"
              }
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
          y_scale: {
            type: "string",
            title: "Y-axis Scale",
            enum: ["linear", "log"],
            default: "linear"
          },
          elements: {
            type: "array",
            title: "Plot Elements",
            items: {
              oneOf: [
                {
                  type: "object",
                  title: "Line",
                  properties: {
                    type: {
                      type: "string",
                      const: "Line",
                      title: "Element Type",
                      default: "Line"
                    },
                    params: {
                      type: "object",
                      title: "Parameters",
                      properties: {
                        dataset: datasetNames.length > 0
                          ? { type: "string", enum: datasetNames, title: "Dataset" }
                          : { type: "string", title: "Dataset" },
                        color: { type: "string", title: "Color", default: "blue" },
                        scale: { type: "number", title: "Scale", default: 1 }
                      },
                      required: ["dataset"]
                    }
                  },
                  required: ["type", "params"]
                },
                {
                  type: "object",
                  title: "Points",
                  properties: {
                    type: {
                      type: "string",
                      const: "Points",
                      title: "Element Type",
                      default: "Points"
                    },
                    params: {
                      type: "object",
                      title: "Parameters",
                      properties: {
                        dataset: datasetNames.length > 0
                          ? { type: "string", enum: datasetNames, title: "Dataset" }
                          : { type: "string", title: "Dataset" },
                        color: { type: "string", title: "Color", default: "red" }
                      },
                      required: ["dataset"]
                    }
                  },
                  required: ["type", "params"]
                },
                {
                  type: "object",
                  title: "Flightline Plot",
                  properties: {
                    type: {
                      type: "string",
                      const: "FlightlinePlot",
                      title: "Element Type",
                      default: "FlightlinePlot"
                    },
                    params: {
                      type: "object",
                      title: "Parameters",
                      properties: {
                        dataset: datasetNames.length > 0
                          ? { type: "string", enum: datasetNames, title: "Dataset" }
                          : { type: "string", title: "Dataset" },
                        x_column: { type: "string", title: "X Column", default: "lon" },
                        y_column: { type: "string", title: "Y Column", default: "lat" },
                        mode: {
                          type: "string",
                          enum: ["lines", "markers", "lines+markers"],
                          title: "Mode",
                          default: "markers"
                        },
                        color: { type: "string", title: "Color", default: "blue" }
                      },
                      required: ["dataset"]
                    }
                  },
                  required: ["type", "params"]
                },
                {
                  type: "object",
                  title: "Channel Plot",
                  properties: {
                    type: {
                      type: "string",
                      const: "ChannelPlot",
                      title: "Element Type",
                      default: "ChannelPlot"
                    },
                    params: {
                      type: "object",
                      title: "Parameters",
                      properties: {
                        dataset: datasetNames.length > 0
                          ? { type: "string", enum: datasetNames, title: "Dataset" }
                          : { type: "string", title: "Dataset" },
                        channel: {
                          type: "string",
                          title: "Channel",
                          enum: ["ch1gt", "ch2gt"],
                          default: "ch1gt"
                        },
                        channel_color: {
                          type: "string",
                          title: "Channel Color",
                          default: "#377eb8"
                        },
                        negative_color: {
                          type: "string",
                          title: "Negative Value Color",
                          default: "black"
                        }
                      },
                      required: ["dataset", "channel"]
                    }
                  },
                  required: ["type", "params"]
                }
              ]
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
      y_scale: "linear",
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
