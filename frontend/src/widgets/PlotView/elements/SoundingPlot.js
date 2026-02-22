import { LayerType, registerLayerType } from 'gladly-plot';
import { parseColor, fillColorArrays, datasetProp, getFrom, getKeys } from '../colorUtils.js';

registerLayerType('SoundingPlot', new LayerType({
  name: 'SoundingPlot',

  getAxisConfig: () => ({
    xAxis: 'xaxis_bottom',
    xAxisQuantityKind: 'time_s',
    yAxis: 'yaxis_left',
    yAxisQuantityKind: 'dbdt_abs_pT',
  }),

  vert: `
    precision mediump float;
    attribute float x, y, r, g, b;
    uniform vec2 xDomain, yDomain;
    uniform float xScaleType, yScaleType;
    uniform float pointSize;
    varying vec3 vColor;
    void main() {
      if (y != y) {
        gl_Position = vec4(2.0, 0.0, 0.0, 1.0);
        return;
      }
      float nx = normalize_axis(x, xDomain, xScaleType);
      float ny = normalize_axis(y, yDomain, yScaleType);
      gl_Position = vec4(nx * 2.0 - 1.0, ny * 2.0 - 1.0, 0.0, 1.0);
      gl_PointSize = pointSize;
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
      dataset: datasetProp(data),
      channel: { type: 'string', enum: ['Ch01', 'Ch02'], default: 'Ch01'   },
      color:   { type: 'string',                         default: '#e41a1c' },
    },
    required: ['dataset', 'channel'],
  }),

  createLayer: function(parameters, data) {
    const currentSounding = data?._currentSounding;
    if (currentSounding === undefined || currentSounding === null) return [];

    const dataset     = data?.[parameters.dataset];
    const flightlines = dataset?.flightlines;
    const layer_data  = dataset?.layer_data;
    if (!flightlines || !layer_data) return [];

    const xdist = flightlines.xdist;
    if (!xdist || currentSounding < 0 || currentSounding >= xdist.length) return [];

    const channel       = parameters.channel || 'Ch01';
    const channelNumber = { Ch01: 1, Ch02: 2 }[channel];
    if (!channelNumber) return [];

    let gateTimeArray;
    try { gateTimeArray = dataset.gate_times(channelNumber); }
    catch (e) { return []; }

    const yDataDict = layer_data[`Gate_${channel}`];
    if (!yDataDict) return [];

    const gateIndices = getKeys(yDataDict).sort((a, b) => a - b);
    const xVals = [], yVals = [];

    gateIndices.forEach((gateIdx, idx) => {
      const gateData = getFrom(yDataDict, gateIdx);
      if (!gateData || currentSounding >= gateData.length || idx >= gateTimeArray.length) return;
      const absY = Math.abs(Number(gateData[currentSounding]));
      yVals.push((absY > 0 && isFinite(absY)) ? absY : NaN);
      xVals.push(Math.abs(gateTimeArray[idx][0]));
    });

    if (xVals.length === 0 || yVals.every(v => !isFinite(v))) return [];

    const rgb = parseColor(parameters.color || '#e41a1c');
    const result = [];

    // Split into contiguous finite segments — a NaN y in a line strip doesn't
    // break the line; WebGL still draws through the off-screen position, which
    // appears as a diagonal artifact to the right.
    let segStart = null;
    for (let i = 0; i <= xVals.length; i++) {
      const valid = i < xVals.length && isFinite(yVals[i]);
      if (valid && segStart === null) {
        segStart = i;
      } else if (!valid && segStart !== null) {
        const len = i - segStart;
        if (len >= 2) {
          const segX = new Float32Array(xVals.slice(segStart, i));
          const segY = new Float32Array(yVals.slice(segStart, i));
          const { r, g, b } = fillColorArrays(len, rgb);
          result.push({ attributes: { x: segX, y: segY, r, g, b }, uniforms: { pointSize: 1.0 }, primitive: 'line strip' });
        }
        segStart = null;
      }
    }

    // Dot markers for all valid points (independent of segment size)
    const validX = xVals.filter((_, i) => isFinite(yVals[i]));
    const validY = yVals.filter(v => isFinite(v));
    if (validX.length > 0) {
      const { r, g, b } = fillColorArrays(validX.length, rgb);
      result.push({ attributes: { x: new Float32Array(validX), y: new Float32Array(validY), r, g, b }, uniforms: { pointSize: 6.0 }, primitive: 'points' });
    }

    return result;
  },
}));
