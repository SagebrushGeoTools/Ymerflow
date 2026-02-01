export default {
  // Declare axis types for this element
  xaxis: "time_s",
  yaxis: "dbdt_abs_pT",

  get_schema: (data_context = {}) => {
    const datasets = data_context.datasets || [];
    const datasetNames = datasets.map(d => d.dataset_name);

    return {
      type: "object",
      title: "Sounding Plot",
      properties: {
        type: {
          type: "string",
          const: "SoundingPlot",
          title: "Element Type",
          default: "SoundingPlot"
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
              enum: ["Ch01", "Ch02"],
              default: "Ch01"
            },
            color: {
              type: "string",
              title: "Line Color",
              default: "#e41a1c"
            }
          },
          required: ["dataset", "channel"]
        }
      },
      required: ["type", "params"]
    };
  },

  render: ({ params, dataset, currentSounding }) => {
    console.log("SoundingPlot render called with:", { params, currentSounding, dataset });

    const flightlines = dataset?.flightlines;
    const layer_data = dataset?.layer_data;

    if (!flightlines || !layer_data) {
      console.warn("Dataset missing flightlines or layer_data:", dataset);
      return null;
    }

    if (currentSounding === undefined || currentSounding === null) {
      console.warn("No currentSounding specified");
      return null;
    }

    const xdist = flightlines.xdist;
    if (!xdist || currentSounding < 0 || currentSounding >= xdist.length) {
      console.warn("currentSounding out of bounds:", currentSounding, "length:", xdist?.length);
      return null;
    }

    const channel = params.channel || "Ch01";
    const color = params.color || '#e41a1c';

    // Map channel name to channel number for gate_times method
    const channelMap = {
      "Ch01": 1,
      "Ch02": 2
    };
    const channelNumber = channelMap[channel];

    if (!channelNumber) {
      console.warn(`Unknown channel: ${channel}`);
      return null;
    }

    // Get gate times from dataset using the gate_times method
    let gateTimeArray;
    try {
      gateTimeArray = dataset.gate_times(channelNumber);
    } catch (error) {
      console.warn(`Failed to get gate times for channel ${channelNumber}:`, error);
      return null;
    }

    console.log(`Gate times for channel ${channelNumber}:`, gateTimeArray);

    // Get data for this channel
    const dataKey = `Gate_${channel}`;
    const yDataDict = layer_data[dataKey];

    if (!yDataDict) {
      console.warn(`Missing data for channel ${channel} (key: ${dataKey})`);
      return null;
    }

    // Extract values for the current sounding from each gate
    const yValues = [];
    const xValues = [];

    // Get gate indices sorted numerically
    const gateIndices = Object.keys(yDataDict).sort((a, b) => parseInt(a) - parseInt(b));

    console.log(`Gate indices for ${channel}:`, gateIndices);

    gateIndices.forEach((gateIdx, idx) => {
      const gateData = yDataDict[gateIdx];

      if (gateData && currentSounding < gateData.length) {
        const value = gateData[currentSounding];
        const absValue = Math.abs(value);

        // Only include positive values for log scale
        if (absValue > 0 && idx < gateTimeArray.length) {
          yValues.push(absValue);
          // Use the center time (first column) from the gate time array
          const centerTime = Math.abs(gateTimeArray[idx][0]);
          xValues.push(centerTime);
        }
      }
    });

    console.log("Sounding plot data:", { xValues, yValues });

    if (xValues.length === 0 || yValues.length === 0) {
      console.warn("No valid data points for sounding plot");
      return null;
    }

    // Create scatter plot with lines and markers
    return {
      x: xValues,
      y: yValues,
      type: "scatter",
      mode: "lines+markers",
      name: `Sounding ${currentSounding} (${channel})`,
      line: { color: color },
      marker: { color: color, size: 6 },
      showlegend: true
    };
  }
};
