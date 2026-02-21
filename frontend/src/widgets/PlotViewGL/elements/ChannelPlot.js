import { LayerType, registerLayerType } from 'gladly-plot';
import { parseColor, toFloat32Array, datasetProp } from '../colorUtils.js';

registerLayerType('ChannelPlot', new LayerType({
  name: 'ChannelPlot',

  getAxisConfig: () => ({
    xAxis: 'xaxis_bottom',
    xAxisQuantityKind: 'xdist_m',
    yAxis: 'yaxis_left',
    yAxisQuantityKind: 'dbdt_abs_pT',
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
      gl_PointSize = 1.5;
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
      dataset:        datasetProp(data),
      channel:        { type: 'string', enum: ['Ch01', 'Ch02'], default: 'Ch01'    },
      channel_color:  { type: 'string',                         default: '#377eb8' },
      negative_color: { type: 'string',                         default: 'black'   },
    },
    required: ['dataset', 'channel'],
  }),

  createLayer: function(parameters, data) {
    const dataset     = data?.[parameters.dataset];
    const flightlines = dataset?.flightlines;
    const layer_data  = dataset?.layer_data;
    if (!flightlines || !layer_data) return [];

    const xdistRaw = flightlines.xdist;
    if (!xdistRaw) return [];

    const channel   = parameters.channel || 'Ch01';
    const yDataDict = layer_data[`Gate_${channel}`];
    if (!yDataDict) return [];

    let inuseDict = layer_data[`InUse_${channel}`];
    if (!inuseDict) {
      inuseDict = {};
      for (const k in yDataDict) inuseDict[k] = new Array(yDataDict[k].length).fill(1);
    }

    const channelRgb  = parseColor(parameters.channel_color  || '#377eb8');
    const grayRgb     = parseColor('#cccccc');
    const negativeRgb = parseColor(parameters.negative_color || 'black');

    const xdist    = toFloat32Array(xdistRaw);
    const n        = xdist.length;
    const timeGates = Object.keys(yDataDict).sort((a, b) => parseInt(a) - parseInt(b));

    const xVals = [], yVals = [], rVals = [], gVals = [], bVals = [];

    for (const gateIdx of timeGates) {
      const yArr     = yDataDict[gateIdx];
      const inuseArr = inuseDict[gateIdx];
      for (let i = 0; i < n; i++) {
        const rawY  = Number(yArr[i]);
        const absY  = Math.abs(rawY);
        const inuse = Number(inuseArr[i]);
        if (absY <= 0 || !isFinite(absY)) continue;
        xVals.push(xdist[i]);
        yVals.push(absY);
        const rgb = inuse === 0 ? grayRgb : (rawY < 0 ? negativeRgb : channelRgb);
        rVals.push(rgb[0]); gVals.push(rgb[1]); bVals.push(rgb[2]);
      }
    }

    if (xVals.length === 0) return [];
    return [{
      attributes: {
        x: new Float32Array(xVals), y: new Float32Array(yVals),
        r: new Float32Array(rVals), g: new Float32Array(gVals), b: new Float32Array(bVals),
      },
      uniforms:  {},
      primitive: 'points',
    }];
  },
}));
