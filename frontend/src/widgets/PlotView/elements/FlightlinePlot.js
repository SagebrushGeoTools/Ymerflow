export default {
  // Declare axis types for this element
  xaxis: "lon_deg",
  yaxis: "lat_deg",

  get_schema: (data_context = {}) => {
    const processes = data_context.processes || [];

    // Extract all output dataset names from all processes
    const datasetNames = [];
    processes.forEach(proc => {
      proc.versions?.forEach(ver => {
        if (ver.outputs) {
          datasetNames.push(...Object.keys(ver.outputs));
        }
      });
    });

    return {
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
    };
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
};
