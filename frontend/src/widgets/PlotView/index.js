import React, { useContext, useState, useEffect } from "react";
import Plot from "react-plotly.js";
import { useProcessOutputDatasets } from "../../datamodel/useQueries";
import { ProcessContext } from '../../ProcessContext';
import { loadDataset } from '../../datamodel/dataset';
import PLOT_ELEMENTS from './elements';
import AXIS_TYPES from './axis';

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

  // Determine current axis types from elements
  let xAxisType = null;
  let yAxisType = null;
  if (config.elements && config.elements.length > 0) {
    const firstElement = PLOT_ELEMENTS[config.elements[0].type];
    if (firstElement) {
      xAxisType = firstElement.xaxis;
      yAxisType = firstElement.yaxis;
    }
  }

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

  // Get axis configurations from AXIS_TYPES
  const xAxisConfig = xAxisType ? AXIS_TYPES[xAxisType] : { title: "" };
  const yAxisConfig = yAxisType ? AXIS_TYPES[yAxisType] : { title: "" };

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
              xaxis: xAxisConfig,
              yaxis: yAxisConfig
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
  // Determine current axis assignments from existing elements
  const layoutConfig = data_context.layoutConfig || {};
  const elements = layoutConfig.elements || [];

  let xAxisType = null;
  let yAxisType = null;
  if (elements.length > 0) {
    const firstElement = PLOT_ELEMENTS[elements[0].type];
    if (firstElement) {
      xAxisType = firstElement.xaxis;
      yAxisType = firstElement.yaxis;
    }
  }

  // Filter PLOT_ELEMENTS to only include axis-compatible elements
  const compatibleElements = Object.entries(PLOT_ELEMENTS).filter(([elementType, element]) => {
    // If no axes are assigned yet, all elements are compatible
    if (!xAxisType || !yAxisType) return true;

    // Otherwise, only include elements with matching axis types
    return element.xaxis === xAxisType && element.yaxis === yAxisType;
  });

  // Generate oneOf array from compatible elements
  const elementSchemas = compatibleElements.map(([elementType, element]) => {
    if (element.get_schema) {
      return element.get_schema(data_context);
    }
    // Fallback for elements without get_schema (shouldn't happen)
    console.warn(`Plot element ${elementType} missing get_schema method`);
    return null;
  }).filter(schema => schema !== null);

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
          elements: {
            type: "array",
            title: "Plot Elements",
            items: {
              oneOf: elementSchemas
            }
          }
        }
      }
    },
    required: ["layoutConfig"]
  };
};

PlotView.get_default = (data_context = {}) => {
  return {
    layoutConfig: {
      title: "Process Outputs",
      elements: []
    }
  };
};
