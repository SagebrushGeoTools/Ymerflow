export default {
  // Declare axis types for this element (same as ChannelPlot)
  xaxis: "xdist_m",
  yaxis: "dbdt_abs_pT",

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
      title: "Sounding Marker",
      properties: {
        type: {
          type: "string",
          const: "SoundingMarker",
          title: "Element Type",
          default: "SoundingMarker"
        },
        params: {
          type: "object",
          title: "Parameters",
          properties: {
            dataset: datasetNames.length > 0
              ? { type: "string", enum: datasetNames, title: "Dataset" }
              : { type: "string", title: "Dataset" },
            color: {
              type: "string",
              title: "Marker Color",
              default: "#ff0000"
            }
          },
          required: ["dataset"]
        }
      },
      required: ["type", "params"]
    };
  },

  render: ({ params, dataset, currentSounding }) => {
    console.log("SoundingMarker render called with:", { params, currentSounding, dataset });

    const flightlines = dataset?.flightlines;
    const layer_data = dataset?.layer_data;

    if (!flightlines || !layer_data) {
      console.warn("Dataset missing flightlines or layer_data:", dataset);
      return null;
    }

    const xdist = flightlines.xdist;
    if (!xdist || currentSounding === undefined || currentSounding === null) {
      console.warn("No xdist or currentSounding:", { xdist, currentSounding });
      return null;
    }

    // Get the x position for the current sounding
    if (currentSounding < 0 || currentSounding >= xdist.length) {
      console.warn("currentSounding out of bounds:", currentSounding, "length:", xdist.length);
      return null;
    }

    const xPosition = xdist[currentSounding];
    const color = params.color || '#ff0000';

    // Find min/max y values from all channel data to span the plot
    let minY = Infinity;
    let maxY = -Infinity;

    // Iterate through all layer_data to find the range
    for (const [key, dataDict] of Object.entries(layer_data)) {
      if (key.startsWith('dbdt_') && !key.includes('inuse')) {
        for (const gateData of Object.values(dataDict)) {
          for (const val of gateData) {
            const absVal = Math.abs(val);
            if (absVal > 0) { // Ignore zeros for log scale
              minY = Math.min(minY, absVal);
              maxY = Math.max(maxY, absVal);
            }
          }
        }
      }
    }

    // If we didn't find any data, use default range
    if (!isFinite(minY) || !isFinite(maxY)) {
      minY = 0.1;
      maxY = 1000;
    }

    // Extend the range slightly for better visibility
    const logMin = Math.log10(minY);
    const logMax = Math.log10(maxY);
    const logRange = logMax - logMin;
    minY = Math.pow(10, logMin - logRange * 0.1);
    maxY = Math.pow(10, logMax + logRange * 0.1);

    // Create a vertical line using a scatter trace
    return {
      x: [xPosition, xPosition],
      y: [minY, maxY],
      type: "scatter",
      mode: "lines",
      name: "Current Sounding",
      line: {
        color: color,
        width: 2,
        dash: 'dash'
      },
      showlegend: false,
      hoverinfo: 'skip'
    };
  }
};
