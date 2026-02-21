import { LayerType, registerLayerType } from 'gladly-plot';
import { parseColor, fillColorArrays, datasetProp, getFrom, getKeys } from '../colorUtils.js';

registerLayerType('SoundingMarker', new LayerType({
  name: 'SoundingMarker',

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
      color:   { type: 'string', default: '#ff0000' },
    },
    required: ['dataset'],
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

    const xPos = Number(xdist[currentSounding]);
    const rgb  = parseColor(parameters.color || '#ff0000');

    // Scan layer_data to compute the y range for a full-height line
    let minY = Infinity, maxY = -Infinity;
    for (const colKey of getKeys(layer_data)) {
      const dataDict = getFrom(layer_data, colKey);
      if (dataDict && typeof dataDict === 'object') {
        for (const gateKey of getKeys(dataDict)) {
          const arr = getFrom(dataDict, gateKey);
          if (arr && (Array.isArray(arr) || ArrayBuffer.isView(arr))) {
            for (let i = 0; i < arr.length; i++) {
              const v = Math.abs(Number(arr[i]));
              if (v > 0 && isFinite(v)) { minY = Math.min(minY, v); maxY = Math.max(maxY, v); }
            }
          }
        }
      }
    }
    if (!isFinite(minY) || !isFinite(maxY)) { minY = 0.1; maxY = 1000; }

    const logMin = Math.log10(minY), logMax = Math.log10(maxY), span = logMax - logMin;
    minY = Math.pow(10, logMin - span * 0.1);
    maxY = Math.pow(10, logMax + span * 0.1);

    const { r, g, b } = fillColorArrays(2, rgb);
    return [{
      attributes: { x: new Float32Array([xPos, xPos]), y: new Float32Array([minY, maxY]), r, g, b },
      uniforms:   {},
      primitive:  'line strip',
    }];
  },
}));
