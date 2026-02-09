export default {
  // Declare axis types for this element
  xaxis: "xdist_m",
  yaxis: "dbdt_abs_pT",

  get_schema: (data_context = {}) => {
    const datasets = data_context.datasets || [];
    const datasetNames = datasets.map(d => d.dataset_name);

    return {
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
              enum: ["Ch01", "Ch02"],
              default: "Ch01"
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
    };
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

    const channel = params.channel || "Ch01";
    const traces = [];

    const dataKey = `Gate_${channel}`;
    const inuseKey = `InUse_${channel}`;

    console.log(`Processing channel ${channel}, dataKey: ${dataKey}, inuseKey: ${inuseKey}`);

    const yDataDict = layer_data[dataKey];
    let inuseDataDict = layer_data[inuseKey];

    console.log(`yDataDict:`, yDataDict, `keys:`, Object.keys(yDataDict || {}));
    console.log(`inuseDataDict:`, inuseDataDict, `keys:`, Object.keys(inuseDataDict || {}));

    if (!yDataDict) {
      console.warn(`Missing data for channel ${channel}`);
      return null;
    }

    // If InUse data is missing, create synthetic "all in use" data
    if (!inuseDataDict) {
      console.log(`InUse data missing for ${channel}, treating all values as in use`);
      inuseDataDict = {};
      // Create synthetic InUse data matching the structure of yDataDict
      for (const gateIdx in yDataDict) {
        const gateLength = yDataDict[gateIdx].length;
        inuseDataDict[gateIdx] = new Array(gateLength).fill(1);
      }
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
};
