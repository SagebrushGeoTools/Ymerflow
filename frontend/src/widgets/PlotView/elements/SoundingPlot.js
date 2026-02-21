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
      if (absY <= 0 || !isFinite(absY)) return;
      yVals.push(absY);
      xVals.push(Math.abs(gateTimeArray[idx][0]));
    });

    if (xVals.length === 0) return [];

    const rgb = parseColor(parameters.color || '#e41a1c');
    const { r, g, b } = fillColorArrays(xVals.length, rgb);
    const x = new Float32Array(xVals);
    const y = new Float32Array(yVals);
    const attribs = { x, y, r, g, b };

    return [
      { attributes: attribs, uniforms: { pointSize: 1.0 }, primitive: 'line strip' },
      { attributes: attribs, uniforms: { pointSize: 6.0 }, primitive: 'points'     },
    ];
  },
}));
