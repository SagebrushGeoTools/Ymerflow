export default {
  // Declare axis types for this element
  xaxis: "index",
  yaxis: "mag_nT",

  get_schema: (data_context = {}) => {
    const datasets = data_context.datasets || [];
    const magDatasets = datasets.filter(d =>
      d.mime_type === 'application/x-magdata-msgpack'
    );
    const datasetNames = magDatasets.map(d => d.dataset_name);

    return {
      type: "object",
      title: "Mag Line Plot",
      properties: {
        type: {
          type: "string",
          const: "MagLinePlot",
          title: "Element Type",
          default: "MagLinePlot"
        },
        params: {
          type: "object",
          title: "Parameters",
          properties: {
            dataset: datasetNames.length > 0
              ? { type: "string", enum: datasetNames, title: "Dataset" }
              : { type: "string", title: "Dataset" },
            columns: {
              type: "array",
              title: "Columns to Plot",
              items: { type: "string" },
              default: ["magcom", "diurnal"],
              description: "Columns to plot (e.g., magcom, diurnal, residual, maguncom)"
            },
            xcolumn: {
              type: "string",
              title: "X-axis Column",
              default: "fidcount",
              description: "Column for x-axis (fidcount, easting, northing, etc.)"
            },
            mode: {
              type: "string",
              enum: ["lines", "markers", "lines+markers"],
              title: "Plot Mode",
              default: "lines"
            }
          },
          required: ["dataset"]
        }
      },
      required: ["type", "params"]
    };
  },

  render: ({ params, dataset }) => {
    console.log("MagLinePlot render called with:", { params, dataset });

    // Handle MagData dataset object
    if (!dataset?.data) {
      console.warn("Dataset has no data property:", dataset);
      return null;
    }

    const magData = dataset.data;

    // The dataset is already filtered to the current part (line)
    // So we plot ALL the data we receive
    const dataLength = dataset.length;

    if (dataLength === 0) {
      console.warn("No data in dataset for current part");
      return null;
    }

    // Get line number from the data (for display purposes)
    const lineCol = magData.line;
    const lineName = lineCol ? lineCol[0] : "Unknown";

    // Get x-axis data
    const xcolumn = params.xcolumn || "fidcount";
    const xData = magData[xcolumn];
    if (!xData) {
      console.warn(`X-axis column '${xcolumn}' not found in dataset`);
      return null;
    }

    // Build traces for each column
    const traces = [];
    const columns = params.columns || ["magcom", "diurnal"];
    const colors = ["blue", "red", "green", "purple", "orange", "brown"];

    columns.forEach((column, idx) => {
      let yValues;
      let traceName;

      // Special handling for "residual" column
      if (column === "residual") {
        const magcom = magData.magcom;
        const diurnal = magData.diurnal;

        if (!magcom || !diurnal) {
          console.warn("Cannot compute residual: missing magcom or diurnal");
          return;
        }

        // Compute residual = magcom - diurnal
        yValues = Array.from(magcom).map((val, i) => val - diurnal[i]);
        traceName = "residual (magcom - diurnal)";
      } else {
        // Regular column
        const yData = magData[column];
        if (!yData) {
          console.warn(`Column '${column}' not found in dataset`);
          return;
        }

        yValues = Array.from(yData);
        traceName = column;
      }

      const trace = {
        x: Array.from(xData),
        y: yValues,
        type: "scatter",
        mode: params.mode || "lines",
        name: `Line ${lineName}: ${traceName}`,
        line: {
          color: colors[idx % colors.length]
        }
      };

      traces.push(trace);
    });

    console.log("Generated traces:", traces);
    return traces;
  }
};
