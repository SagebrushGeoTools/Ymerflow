import { LayerType, registerLayerType } from 'gladly-plot';
import { fillColorArrays, toFloat32Array, datasetProp } from '../colorUtils.js';

// Per-vertex unit-quad corners for instanced rect rendering (two CCW triangles)
const QUAD_CX = new Float32Array([0, 1, 1, 0, 1, 0]);
const QUAD_CY = new Float32Array([0, 0, 1, 0, 1, 1]);

function getFrom(dict, key) {
  return dict && typeof dict.get === 'function' ? dict.get(key) : dict?.[key];
}

function getKeys(dict) {
  return dict && typeof dict.keys === 'function'
    ? Array.from(dict.keys())
    : Object.keys(dict || {});
}

// ─── ResistivityCurtain ─ coloured instanced rectangles ──────────────────────
registerLayerType('ResistivityCurtain', new LayerType({
  name: 'ResistivityCurtain',

  getAxisConfig: () => ({
    xAxis: 'xaxis_bottom',
    xAxisQuantityKind: 'xdist_m',
    yAxis: 'yaxis_left',
    yAxisQuantityKind: 'elevation_m',
    colorAxisQuantityKinds: ['log_resistivity'],
  }),

  vert: `
    precision mediump float;
    attribute float cx, cy;
    attribute float x, xPrev, xNext, top, bot;
    attribute float log_resistivity;
    uniform vec2 xDomain, yDomain;
    uniform float xScaleType, yScaleType;
    varying float vVal;
    void main() {
      float hl = (x - xPrev) / 2.0;
      float hr = (xNext - x) / 2.0;
      float xPos = cx > 0.5 ? x + hr : x - hl;
      float yPos = cy > 0.5 ? top : bot;
      float nx = normalize_axis(xPos, xDomain, xScaleType);
      float ny = normalize_axis(yPos, yDomain, yScaleType);
      gl_Position = vec4(nx * 2.0 - 1.0, ny * 2.0 - 1.0, 0.0, 1.0);
      vVal = log_resistivity;
    }
  `,

  frag: `
    precision mediump float;
    uniform int colorscale_log_resistivity;
    uniform vec2 color_range_log_resistivity;
    uniform float color_scale_type_log_resistivity;
    varying float vVal;
    void main() {
      // vVal is stored as log10(Ωm); convert to actual Ωm so the colour axis
      // operates in real units (default scale: log, but user can switch to linear).
      float resistivity = pow(10.0, vVal);
      gl_FragColor = map_color_s(
        colorscale_log_resistivity,
        color_range_log_resistivity,
        resistivity,
        color_scale_type_log_resistivity
      );
    }
  `,

  schema: (data) => ({
    type: 'object',
    properties: {
      dataset:     datasetProp(data),
      topo_column: { type: 'string', default: 'topo' },
      cmin:        { type: 'number', default: 1    },
      cmax:        { type: 'number', default: 1000 },
    },
    required: ['dataset'],
  }),

  createLayer: function(parameters, data) {
    const dataset     = data?.[parameters.dataset];
    const flightlines = dataset?.flightlines;
    const layer_data  = dataset?.layer_data;
    if (!flightlines || !layer_data) return [];

    const xdistRaw = flightlines.xdist;
    if (!xdistRaw || xdistRaw.length === 0) return [];

    const resistivity = layer_data.resistivity;
    const dep_top     = layer_data.dep_top;
    const dep_bot     = layer_data.dep_bot;
    if (!resistivity || !dep_top || !dep_bot) return [];

    const nS = xdistRaw.length;
    const layerIndices = getKeys(resistivity).sort((a, b) => parseInt(a) - parseInt(b));
    if (layerIndices.length === 0) return [];

    const topoCol = [parameters.topo_column, 'Topography', 'topo', 'elevation']
      .find(col => col && flightlines[col] !== undefined);
    const topo    = topoCol ? flightlines[topoCol] : null;
    const xdist   = toFloat32Array(xdistRaw);

    // Neighbour arrays for half-width calculation
    const xPrevArr = new Float32Array(nS);
    const xNextArr = new Float32Array(nS);
    xPrevArr.set(xdist.subarray(0, nS - 1), 1);
    xPrevArr[0] = nS > 1 ? 2 * xdist[0] - xdist[1] : xdist[0];
    xNextArr.set(xdist.subarray(1), 0);
    xNextArr[nS - 1] = nS > 1 ? 2 * xdist[nS - 1] - xdist[nS - 2] : xdist[nS - 1];

    const xVals = [], xPVals = [], xNVals = [], topVals = [], botVals = [], colVals = [];
    let resMin = Infinity, resMax = -Infinity;

    for (const j of layerIndices) {
      const resArr = getFrom(resistivity, j);
      const topArr = getFrom(dep_top, j);
      const botArr = getFrom(dep_bot, j);
      if (!resArr || !topArr || !botArr) continue;

      for (let i = 0; i < nS; i++) {
        const res = Number(resArr[i]);
        if (!isFinite(res) || res <= 0) continue;
        const t       = topo ? Number(topo[i]) : 0;
        const topElev = t - Number(topArr[i]);
        let   botElev = t - Number(botArr[i]);
        if (!isFinite(topElev)) continue;
        if (!isFinite(botElev)) botElev = topElev - 100;

        xVals.push(xdist[i]); xPVals.push(xPrevArr[i]); xNVals.push(xNextArr[i]);
        topVals.push(topElev); botVals.push(botElev);
        // Store log10(res) in the attribute; the fragment shader converts back to Ωm
        // via pow(10, vVal) before colour-mapping so the colour axis operates in real units.
        colVals.push(Math.log10(res));
        if (res < resMin) resMin = res;
        if (res > resMax) resMax = res;
      }
    }

    if (xVals.length === 0) return [];
    const n = xVals.length;
    const x   = new Float32Array(xVals);
    const xP  = new Float32Array(xPVals);
    const xN  = new Float32Array(xNVals);
    const top = new Float32Array(topVals);
    const bot = new Float32Array(botVals);
    const col = new Float32Array(colVals);

    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i < n; i++) {
      if (isFinite(x[i]))   { xMin = Math.min(xMin, x[i]);   xMax = Math.max(xMax, x[i]);   }
      if (isFinite(top[i])) { yMin = Math.min(yMin, top[i]); yMax = Math.max(yMax, top[i]); }
      if (isFinite(bot[i])) { yMin = Math.min(yMin, bot[i]); yMax = Math.max(yMax, bot[i]); }
    }

    return [{
      attributes: { cx: QUAD_CX, cy: QUAD_CY, x, xPrev: xP, xNext: xN, top, bot, log_resistivity: col },
      attributeDivisors: { x: 1, xPrev: 1, xNext: 1, top: 1, bot: 1, log_resistivity: 1 },
      uniforms: {},
      // Spatial auto-range; colour auto-range in actual Ωm (gladly would otherwise scan
      // the log10 attribute array and produce a wrong [logMin, logMax] range).
      domains: { xdist_m: [xMin, xMax], elevation_m: [yMin, yMax], log_resistivity: [resMin, resMax] },
      primitive: 'triangles',
      vertexCount: 6,
      instanceCount: n,
    }];
  },
}));

// ─── ResistivityCurtainLines ─ topo surface + sounding marker ────────────────
registerLayerType('ResistivityCurtainLines', new LayerType({
  name: 'ResistivityCurtainLines',

  getAxisConfig: () => ({
    xAxis: 'xaxis_bottom',
    xAxisQuantityKind: 'xdist_m',
    yAxis: 'yaxis_left',
    yAxisQuantityKind: 'elevation_m',
  }),

  vert: `
    precision mediump float;
    attribute float x, y, r, g, b;
    uniform vec2 xDomain, yDomain;
    uniform float xScaleType, yScaleType;
    varying vec3 vColor;
    void main() {
      float nx = normalize_axis(x, xDomain, xScaleType);
      float ny = normalize_axis(y, yDomain, yScaleType);
      gl_Position = vec4(nx * 2.0 - 1.0, ny * 2.0 - 1.0, 0.0, 1.0);
      vColor = vec3(r, g, b);
    }
  `,

  frag: `
    precision mediump float;
    varying vec3 vColor;
    void main() { gl_FragColor = vec4(vColor, 1.0); }
  `,

  schema: (data) => ({
    type: 'object',
    properties: {
      dataset:     datasetProp(data),
      topo_column: { type: 'string', default: 'topo' },
    },
    required: ['dataset'],
  }),

  createLayer: function(parameters, data) {
    const currentSounding = data?._currentSounding;

    const dataset     = data?.[parameters.dataset];
    const flightlines = dataset?.flightlines;
    const layer_data  = dataset?.layer_data;
    if (!flightlines || !layer_data) return [];

    const xdistRaw = flightlines.xdist;
    if (!xdistRaw || xdistRaw.length === 0) return [];

    const nS    = xdistRaw.length;
    const xdist = toFloat32Array(xdistRaw);
    const results = [];

    // Topography line (black)
    const topoCol = [parameters.topo_column, 'Topography', 'topo', 'elevation']
      .find(col => col && flightlines[col] !== undefined);
    if (topoCol) {
      const topoY  = toFloat32Array(flightlines[topoCol]);
      const { r, g, b } = fillColorArrays(nS, [0, 0, 0]);
      results.push({ attributes: { x: xdist, y: topoY, r, g, b }, uniforms: {}, primitive: 'line strip' });
    }

    // Sounding marker (red vertical line)
    const cs = currentSounding;
    if (cs !== undefined && cs !== null && cs >= 0 && cs < nS) {
      const dep_top = layer_data.dep_top;
      const dep_bot = layer_data.dep_bot;
      const topo    = topoCol ? flightlines[topoCol] : null;

      let yMin = Infinity, yMax = -Infinity;
      if (dep_top && dep_bot) {
        for (const j of getKeys(dep_top)) {
          const topArr = getFrom(dep_top, j);
          const botArr = getFrom(dep_bot, j);
          if (!topArr || !botArr) continue;
          for (let i = 0; i < nS; i++) {
            const t   = topo ? Number(topo[i]) : 0;
            const top = t - Number(topArr[i]);
            const bot = t - Number(botArr[i]);
            if (isFinite(top)) { yMin = Math.min(yMin, top); yMax = Math.max(yMax, top); }
            if (isFinite(bot)) { yMin = Math.min(yMin, bot); yMax = Math.max(yMax, bot); }
          }
        }
      }
      if (!isFinite(yMin)) yMin = 0;
      if (!isFinite(yMax)) yMax = 100;

      const xPos = xdist[cs];
      const { r, g, b } = fillColorArrays(2, [1, 0, 0]);
      results.push({
        attributes: { x: new Float32Array([xPos, xPos]), y: new Float32Array([yMin, yMax]), r, g, b },
        uniforms:   {},
        primitive:  'line strip',
      });
    }

    return results;
  },
}));
