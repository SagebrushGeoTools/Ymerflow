export default {
  xaxis: "xdist_m",
  yaxis: "elevation_m",

  get_schema: (data_context = {}) => {
    const datasets = data_context.datasets || [];
    const datasetNames = datasets.map(d => d.dataset_name);

    return {
      type: "object",
      title: "Resistivity Curtain",
      properties: {
        type: {
          type: "string",
          const: "ResistivityCurtain",
          title: "Element Type",
          default: "ResistivityCurtain"
        },
        params: {
          type: "object",
          title: "Parameters",
          properties: {
            dataset: datasetNames.length > 0
              ? { type: "string", enum: datasetNames, title: "Dataset" }
              : { type: "string", title: "Dataset" },
            topo_column: {
              type: "string",
              title: "Topography Column",
              default: "topo"
            },
            cmin: {
              type: "number",
              title: "Min Resistivity (Ωm)",
              default: 1
            },
            cmax: {
              type: "number",
              title: "Max Resistivity (Ωm)",
              default: 1000
            }
          },
          required: ["dataset"]
        }
      },
      required: ["type", "params"]
    };
  },

  render: ({ params, dataset, currentSounding }) => {
    const flightlines = dataset?.flightlines;
    const layer_data = dataset?.layer_data;
    if (!flightlines || !layer_data) return null;

    const xdist = flightlines.xdist;
    if (!xdist || xdist.length === 0) return null;

    const resistivity = layer_data.resistivity;
    const dep_top = layer_data.dep_top;
    const dep_bot = layer_data.dep_bot;
    if (!resistivity || !dep_top || !dep_bot) return null;

    const nSoundings = xdist.length;
    const layerIndices = Object.keys(resistivity).sort((a, b) => parseInt(a) - parseInt(b));
    const nLayers = layerIndices.length;
    if (nSoundings === 0 || nLayers === 0) return null;

    // Resolve topography: try user-specified column, then common names
    const topoCol = [params.topo_column, 'Topography', 'topo', 'elevation']
      .find(col => col && flightlines[col] !== undefined);
    const topo = topoCol ? flightlines[topoCol] : null;

    // First pass: determine elevation bounds from finite values only
    let zMin = Infinity;
    let zMax = -Infinity;
    for (const j of layerIndices) {
      for (let i = 0; i < nSoundings; i++) {
        const t = topo ? Number(topo[i]) : 0;
        const top = t - Number(dep_top[j][i]);
        const bot = t - Number(dep_bot[j][i]);
        if (isFinite(top)) { zMax = Math.max(zMax, top); zMin = Math.min(zMin, top); }
        if (isFinite(bot)) { zMax = Math.max(zMax, bot); zMin = Math.min(zMin, bot); }
      }
    }
    if (!isFinite(zMin) || !isFinite(zMax) || zMin >= zMax) return null;

    // Regular elevation grid: 0.5 m resolution, capped at 500 bins
    const nDepthBins = Math.min(Math.max(Math.round((zMax - zMin) / 0.5), 50), 500);
    const binHeight = (zMax - zMin) / nDepthBins;

    // y values: elevation ascending (low at index 0 → bottom of plot)
    const yBins = new Array(nDepthBins);
    for (let k = 0; k < nDepthBins; k++) {
      yBins[k] = zMin + (k + 0.5) * binHeight;
    }

    // Initialize grids: zGrid[y_idx][x_idx], null renders transparent
    const zGrid = Array.from({ length: nDepthBins }, () => new Array(nSoundings).fill(null));
    const resGrid = Array.from({ length: nDepthBins }, () => new Array(nSoundings).fill(null));

    // Fill grids: paint each layer's bin range per sounding
    for (let i = 0; i < nSoundings; i++) {
      const t = topo ? Number(topo[i]) : 0;
      for (const j of layerIndices) {
        const top = t - Number(dep_top[j][i]);
        let bot = t - Number(dep_bot[j][i]);
        const res = Number(resistivity[j][i]);

        if (!isFinite(top) || res <= 0 || !isFinite(res)) continue;
        if (!isFinite(bot)) bot = zMin; // infinite depth → extend to deepest point

        const effTop = Math.min(top, zMax);
        const effBot = Math.max(bot, zMin);
        if (effTop <= effBot) continue;

        const kStart = Math.max(0, Math.floor((effBot - zMin) / binHeight));
        const kEnd = Math.min(nDepthBins, Math.ceil((effTop - zMin) / binHeight));
        const logRes = Math.log10(res);

        for (let k = kStart; k < kEnd; k++) {
          zGrid[k][i] = logRes;
          resGrid[k][i] = res;
        }
      }
    }

    // Colorbar: log-scaled ticks at powers of 10
    const cmin = params.cmin || 1;
    const cmax = params.cmax || 1000;
    const logCmin = Math.log10(cmin);
    const logCmax = Math.log10(cmax);

    const tickVals = [];
    const tickTexts = [];
    for (let exp = Math.floor(logCmin); exp <= Math.ceil(logCmax); exp++) {
      if (exp >= logCmin && exp <= logCmax) {
        tickVals.push(exp);
        tickTexts.push(String(Math.pow(10, exp)));
      }
    }

    const traces = [
      {
        type: 'heatmap',
        x: Array.from(xdist),
        y: yBins,
        z: zGrid,
        customdata: resGrid,
        colorscale: 'turbo',
        zmin: logCmin,
        zmax: logCmax,
        colorbar: {
          title: { text: 'Resistivity (Ωm)' },
          tickvals: tickVals,
          ticktext: tickTexts
        },
        xgap: 0,
        ygap: 0,
        showscale: true,
        name: 'Resistivity',
        hovertemplate: 'Distance: %{x:.1f} m<br>Elevation: %{y:.1f} m<br>Resistivity: %{customdata:.1f} Ωm<extra></extra>'
      }
    ];

    // Topography surface line
    if (topo) {
      traces.push({
        x: Array.from(xdist),
        y: Array.from(topo),
        type: 'scatter',
        mode: 'lines',
        name: 'Topography',
        line: { color: 'black', width: 1.5 },
        showlegend: false
      });
    }

    // Current sounding marker (vertical dashed line)
    if (currentSounding !== undefined && currentSounding !== null &&
        currentSounding >= 0 && currentSounding < nSoundings) {
      traces.push({
        x: [xdist[currentSounding], xdist[currentSounding]],
        y: [zMin, zMax],
        type: 'scatter',
        mode: 'lines',
        name: 'Current Sounding',
        line: { color: 'red', width: 2, dash: 'dash' },
        showlegend: false,
        hoverinfo: 'skip'
      });
    }

    return traces;
  }
};
