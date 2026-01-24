import React, { useContext, useState, useEffect } from "react";
import Plot from "react-plotly.js";
import { useProcessOutputDatasets } from "../../datamodel/useQueries";
import { ProcessContext } from '../../ProcessContext';
import { loadDataset } from '../../datamodel/dataset';
import PLOT_ELEMENTS from './elements';
import AXIS_TYPES from './axis';

export default function PlotView({ layoutConfig, ...props }) {
  const { activeProcess, processes, currentPart, currentSounding, setCurrentSounding } = useContext(ProcessContext);

  // Find the actual process object from activeProcess
  const process = activeProcess ? processes.find(p => p.id === activeProcess.processId) : null;
  const version = activeProcess?.version;

  const { data: datasets = [], isLoading } = useProcessOutputDatasets(process, version);

  // State for fetched data and dataset objects
  const [fetchedData, setFetchedData] = useState({});
  const [datasetObjects, setDatasetObjects] = useState({});
  const [dataLoading, setDataLoading] = useState(false);
  const [setSoundingMode, setSetSoundingMode] = useState(false);
  const [plotReady, setPlotReady] = useState(false);
  const plotDivRef = React.useRef(null);
  const plotWrapperRef = React.useRef(null);
  const fetchedDataRef = React.useRef(fetchedData);

  // Keep fetchedDataRef in sync with fetchedData state
  useEffect(() => {
    fetchedDataRef.current = fetchedData;
  }, [fetchedData]);

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
      fetchedDataRef.current = newFetchedData;
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
        const result = def.render({ params: el.params, dataset: data, currentSounding });
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

  // Custom mode bar button for setting sounding
  const setSoundingButton = {
    name: 'Set Sounding',
    icon: {
      width: 857.1,
      height: 1000,
      path: 'm214-7h429v214h-429v-214z m500 0h72v500q0 8-6 21t-11 20l-157 156q-5 6-19 12t-22 5v-232q0-22-15-38t-38-16h-322q-22 0-37 16t-16 38v232h-72v-714h72v232q0 22 16 38t37 16h465q22 0 38-16t15-38v-232z m-214 518v178q0 8-5 13t-13 5h-107q-7 0-13-5t-5-13v-178q0-8 5-13t13-5h107q7 0 13 5t5 13z m357-18v-518q0-22-15-38t-38-16h-750q-23 0-38 16t-16 38v750q0 22 16 38t38 16h517q23 0 50-12t42-26l156-157q16-15 27-42t11-49z',
      transform: 'matrix(1 0 0 -1 0 850)'
    },
    click: function(gd) {
      const event = new CustomEvent('toggleSetSoundingMode');
      gd.dispatchEvent(event);
    }
  };

  // Attach direct click handler when in setSounding mode
  useEffect(() => {
    const plotWrapper = plotWrapperRef.current;
    const plotDiv = plotDivRef.current;

    if (!plotWrapper || !plotDiv || !setSoundingMode) {
      return;
    }

    const handleClick = (event) => {

      // Get the xaxis and yaxis from the plot's internal layout
      const xaxis = plotDiv._fullLayout.xaxis;
      const yaxis = plotDiv._fullLayout.yaxis;

      if (!xaxis || !yaxis) {
        console.warn("Could not find axis information");
        return;
      }

      // Get the plot's bounding rect
      const rect = plotDiv.getBoundingClientRect();

      // Get click position relative to the plot div
      const clickX = event.clientX - rect.left;
      const clickY = event.clientY - rect.top;

      // Convert pixel coordinates to data coordinates using axis methods
      // The xaxis has pixel position info in _offset and _length
      const xPixelInPlotArea = clickX - xaxis._offset;

      // Use p2c (pixel to coordinate) conversion
      const clickedX = xaxis.p2c(xPixelInPlotArea);

      // Find the first dataset with flightlines to get xdist array
      let xdist = null;
      for (const datasetData of Object.values(fetchedDataRef.current)) {
        if (datasetData?.flightlines?.xdist) {
          xdist = datasetData.flightlines.xdist;
          break;
        }
      }

      if (!xdist || xdist.length === 0) {
        console.warn("No xdist data available for click handling");
        return;
      }

      // Find the nearest sounding index
      let nearestIndex = 0;
      let minDistance = Math.abs(xdist[0] - clickedX);

      for (let i = 1; i < xdist.length; i++) {
        const distance = Math.abs(xdist[i] - clickedX);
        if (distance < minDistance) {
          minDistance = distance;
          nearestIndex = i;
        }
      }

      setCurrentSounding(nearestIndex);

      // Turn off the mode after setting
      setSetSoundingMode(false);
    };

    plotWrapper.addEventListener('click', handleClick);

    return () => {
      plotWrapper.removeEventListener('click', handleClick);
    };
  }, [setSoundingMode, setCurrentSounding]);

  // Store ref on plot initialization
  const handlePlotInitialized = (figure, graphDiv) => {
    plotDivRef.current = graphDiv;
    setPlotReady(true);
  };

  // Listen for the toggle event from the custom button
  useEffect(() => {
    const plotDiv = plotDivRef.current;
    if (!plotDiv) {
      return;
    }

    const handleToggle = () => {
      setSetSoundingMode(prev => !prev);
    };

    plotDiv.addEventListener('toggleSetSoundingMode', handleToggle);

    return () => {
      plotDiv.removeEventListener('toggleSetSoundingMode', handleToggle);
    };
  }, [plotReady]);


  return (
    <div className="h-100 d-flex flex-column">
      <div className="flex-grow-1" ref={plotWrapperRef}>
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
              yaxis: yAxisConfig,
              hovermode: 'closest'
            }}
            config={{
              displayModeBar: true,
              modeBarButtonsToAdd: [setSoundingButton]
            }}
            useResizeHandler={true}
            style={{
              width: "100%",
              height: "100%",
              cursor: setSoundingMode ? 'crosshair' : 'default'
            }}
            onInitialized={handlePlotInitialized}
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
