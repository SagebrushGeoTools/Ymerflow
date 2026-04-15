import { LayerType, registerLayerType } from 'gladly-plot';
import { parseColor, fillColorArrays, datasetProp, getFrom, getKeys } from '../colorUtils.js';

// 1D resistivity-depth staircase for the currently selected sounding.
// X axis: resistivity (Ωm, log scale)
// Y axis: depth (m, linear, surface at top — stored as negative values so y=0
//          is surface and y=-400 is 400 m depth, matching screen orientation)
registerLayerType('SoundingResistivityPlot', new LayerType({
  name: 'SoundingResistivityPlot',

  getAxisConfig: () => ({
    xAxis: 'xaxis_bottom',
    xAxisQuantityKind: 'resistivity',
    yAxis: 'yaxis_left',
    yAxisQuantityKind: 'depth_m',
  }),

  vert: `#version 300 es
    precision mediump float;
    in float x, y, r, g, b;
    out vec3 vColor;
    void main() {
      if (y != y) {
        gl_Position = vec4(2.0, 0.0, 0.0, 1.0);
        return;
      }
      gl_Position = plot_pos(vec2(x, y));
      vColor = vec3(r, g, b);
    }
  `,

  frag: `#version 300 es
    precision mediump float;
    in vec3 vColor;
    void main() { fragColor = gladly_apply_color(vec4(vColor, 1.0)); }
  `,

  schema: (data) => ({
    type: 'object',
    properties: {
      dataset: datasetProp(data),
      color: {
        type: 'string',
        default: '#333333',
        description: 'Line color (hex or named color)',
      },
    },
    required: ['dataset'],
  }),

  createLayer: function(regl, parameters, data, plot) {
    const rawData = plot?._rawData ?? data;
    const currentSounding = rawData?._currentSounding;
    if (currentSounding === undefined || currentSounding === null) return [];

    const dataset    = rawData?.[parameters.dataset];
    const layer_data = dataset?.layer_data;
    if (!layer_data) return [];

    // Support rho, resistivity, rho_i column naming conventions
    const rhoDict    = layer_data.rho ?? layer_data.resistivity ?? layer_data.rho_i;
    const depTopDict = layer_data.dep_top;
    const depBotDict = layer_data.dep_bot;
    if (!rhoDict || !depTopDict || !depBotDict) return [];

    const layerIndices = getKeys(rhoDict)
      .map(k => parseInt(k))
      .sort((a, b) => a - b);
    if (layerIndices.length === 0) return [];

    // Extract per-layer values for current sounding
    const rhoVals    = [];
    const depTopVals = [];
    const depBotVals = [];

    for (const idx of layerIndices) {
      const rhoArr = getFrom(rhoDict,    idx);
      const topArr = getFrom(depTopDict, idx);
      const botArr = getFrom(depBotDict, idx);
      if (!rhoArr || !topArr || !botArr) continue;

      const r = Number(rhoArr[currentSounding]);
      const t = Number(topArr[currentSounding]);
      let   b = Number(botArr[currentSounding]);

      if (!isFinite(r) || r <= 0 || !isFinite(t)) continue;

      // Halfspace: extend by 1.5× the previous finite thickness, or 50 m minimum
      if (!isFinite(b)) {
        const prevBot = depBotVals.length > 0 ? depBotVals[depBotVals.length - 1] : t;
        const prevTop = depTopVals.length > 0 ? depTopVals[depTopVals.length - 1] : t;
        b = prevBot + Math.max(1.5 * (prevBot - prevTop), 50);
      }

      rhoVals.push(r);
      depTopVals.push(t);
      depBotVals.push(b);
    }

    if (rhoVals.length === 0) return [];

    // Build staircase point list:
    // (rho[0], top[0]) → vertical to (rho[0], bot[0])
    //                  → horizontal to (rho[1], bot[0])
    //                  → vertical to (rho[1], bot[1]) → ...
    // Y values are negated so surface (depth=0) is at top of plot.
    const xVals = [];
    const yVals = [];

    xVals.push(rhoVals[0]);
    yVals.push(-depTopVals[0]);

    for (let i = 0; i < rhoVals.length; i++) {
      // Vertical: down through this layer
      xVals.push(rhoVals[i]);
      yVals.push(-depBotVals[i]);

      // Horizontal: step to next layer's resistivity at this boundary
      if (i < rhoVals.length - 1) {
        xVals.push(rhoVals[i + 1]);
        yVals.push(-depBotVals[i]);
      }
    }

    const n   = xVals.length;
    const xs  = new Float32Array(xVals);
    const ys  = new Float32Array(yVals);
    const rgb = parseColor(parameters.color || '#333333');
    const { r, g, b } = fillColorArrays(n, rgb);

    return [{
      attributes: { x: xs, y: ys, r, g, b },
      uniforms:   { pointSize: 1.0 },
      primitive:  'line strip',
    }];
  },
}));
