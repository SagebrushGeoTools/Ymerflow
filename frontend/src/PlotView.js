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
  },
  ChannelPlot: {
    parameters: {
      dataset: { type: "string" },
      channel: { type: "string", default: "ch1gt" },
      channel_color: { type: "string", default: "#377eb8" },
      negative_color: { type: "string", default: "black" }
    },
    render: ({ params, dataset }) => {
      console.log("ChannelPlot render called with:", { params, dataset });

      const flightlines = dataset?.flightlines;
      const layer_data = dataset?.layer_data;

      console.log("Flightlines keys:", flightlines ? Object.keys(flightlines) : "none");
      console.log("Layer_data keys:", layer_data ? Object.keys(layer_data) : "none");

      if (!flightlines || !layer_data) {
        console.warn("Dataset missing flightlines or layer_data:", dataset);
        return null;
      }

      const xdist = flightlines.xdist;
      if (!xdist) {
        console.warn("No xdist column in flightlines");
        return null;
      }

      const channel = params.channel || "ch1gt";
      const traces = [];

      const dataKey = `dbdt_${channel}`;
      const inuseKey = `dbdt_inuse_${channel}`;

      console.log(`Processing channel ${channel}, dataKey: ${dataKey}, inuseKey: ${inuseKey}`);

      const yDataDict = layer_data[dataKey];
      const inuseDataDict = layer_data[inuseKey];

      console.log(`yDataDict:`, yDataDict, `keys:`, Object.keys(yDataDict || {}));
      console.log(`inuseDataDict:`, inuseDataDict, `keys:`, Object.keys(inuseDataDict || {}));

      if (!yDataDict || !inuseDataDict) {
        console.warn(`Missing data for channel ${channel}`);
        return null;
      }

      const x = Array.from(xdist);
      const channelColor = params.channel_color || '#377eb8';
      const grayColor = '#cccccc';
      const negativeColor = params.negative_color || 'black';

      // Get all time gate indices
      const timeGates = Object.keys(yDataDict).sort((a, b) => parseInt(a) - parseInt(b));
      console.log(`Time gates for channel ${channel}:`, timeGates);

      // Plot each time gate as a separate line
      timeGates.forEach((gateIdx, gatePosition) => {
        const y = Array.from(yDataDict[gateIdx]);
        const inuse = Array.from(inuseDataDict[gateIdx]);

        // Segment the data by inuse flag AND sign
        let currentInuse = null;
        let currentIsNegative = null;
        let segmentX = [];
        let segmentY = [];

        for (let i = 0; i < x.length; i++) {
          const inuseValue = Number(inuse[i]); // Convert BigInt to Number
          const yValue = y[i];
          const isNegative = yValue < 0;

          if (currentInuse !== null && (inuseValue !== currentInuse || isNegative !== currentIsNegative)) {
            // Finish current segment
            if (segmentX.length > 0) {
              const segmentColor = currentInuse === 0
                ? grayColor
                : (currentIsNegative ? negativeColor : channelColor);

              traces.push({
                x: segmentX,
                y: segmentY,
                type: "scatter",
                mode: "lines",
                name: currentInuse === 1 ? `${channel}[${gateIdx}]` : `${channel}[${gateIdx}] (not in use)`,
                line: { color: segmentColor },
                showlegend: currentInuse === 1 && gatePosition === 0, // Only show first gate in legend
                legendgroup: channel
              });
            }
            // Start new segment
            segmentX = [x[i]];
            segmentY = [Math.abs(yValue)];
            currentInuse = inuseValue;
            currentIsNegative = isNegative;
          } else {
            // Continue current segment
            if (currentInuse === null) {
              currentInuse = inuseValue;
              currentIsNegative = isNegative;
            }
            segmentX.push(x[i]);
            segmentY.push(Math.abs(yValue));
          }
        }

        // Finish last segment
        if (segmentX.length > 0) {
          const segmentColor = currentInuse === 0
            ? grayColor
            : (currentIsNegative ? negativeColor : channelColor);

          traces.push({
            x: segmentX,
            y: segmentY,
            type: "scatter",
            mode: "lines",
            name: currentInuse === 1 ? `${channel}[${gateIdx}]` : `${channel}[${gateIdx}] (not in use)`,
            line: { color: segmentColor },
            showlegend: currentInuse === 1 && gatePosition === 0, // Only show first gate in legend
            legendgroup: channel
          });
        }
      });

      console.log("Generated traces:", traces);
      return traces;
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
