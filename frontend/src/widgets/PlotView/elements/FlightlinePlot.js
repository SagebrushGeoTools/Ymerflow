import { LayerType, registerLayerType } from 'gladly-plot';
import { parseColor, fillColorArrays, toFloat32Array, datasetProp } from '../colorUtils.js';

const RGB_VERT = `
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
`;

const RGB_FRAG = `
  precision mediump float;
  varying vec3 vColor;
  void main() { gl_FragColor = vec4(vColor, 1.0); }
`;

registerLayerType('FlightlinePlot', new LayerType({
  name: 'FlightlinePlot',

  getAxisConfig: () => ({
    xAxis: 'xaxis_bottom',
    xAxisQuantityKind: 'epsg_4326_x',
    yAxis: 'yaxis_left',
    yAxisQuantityKind: 'epsg_4326_y',
  }),

  vert: RGB_VERT,
  frag: RGB_FRAG,

  schema: (data) => ({
    type: 'object',
    properties: {
      dataset:  datasetProp(data),
      x_column: { type: 'string', default: 'lon' },
      y_column: { type: 'string', default: 'lat' },
      mode:     { type: 'string', enum: ['lines', 'markers', 'lines+markers'], default: 'markers' },
      color:    { type: 'string', default: 'blue' },
    },
    required: ['dataset'],
  }),

  createLayer: function(parameters, data) {
    const dataset     = data?.[parameters.dataset];
    const flightlines = dataset?.flightlines;
    if (!flightlines) return [];

    const xRaw = flightlines[parameters.x_column || 'lon'];
    const yRaw = flightlines[parameters.y_column || 'lat'];
    if (!xRaw || !yRaw) return [];

    const n   = xRaw.length;
    const x   = toFloat32Array(xRaw);
    const y   = toFloat32Array(yRaw);
    const rgb = parseColor(parameters.color || 'blue');
    const { r, g, b } = fillColorArrays(n, rgb);

    const attribs = { x, y, r, g, b };
    const mode    = parameters.mode || 'markers';
    const results = [];

    if (mode.includes('markers')) results.push({ attributes: attribs, uniforms: { pointSize: 3.0 }, primitive: 'points'     });
    if (mode.includes('lines'))   results.push({ attributes: attribs, uniforms: { pointSize: 1.0 }, primitive: 'line strip' });
    return results;
  },
}));
