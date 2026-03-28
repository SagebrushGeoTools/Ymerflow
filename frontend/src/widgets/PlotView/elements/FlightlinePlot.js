import { LayerType, registerLayerType } from 'gladly-plot';
import { parseColor, fillColorArrays, toFloat32Array, datasetProp } from '../colorUtils.js';

const RGB_VERT = `#version 300 es
  precision mediump float;
  in float x, y, r, g, b;
  uniform float pointSize;
  out vec3 vColor;
  void main() {
    gl_Position = plot_pos(vec2(x, y));
    gl_PointSize = pointSize;
    vColor = vec3(r, g, b);
  }
`;

const RGB_FRAG = `#version 300 es
  precision mediump float;
  in vec3 vColor;
  void main() { fragColor = gladly_apply_color(vec4(vColor, 1.0)); }
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

  createLayer: function(regl, parameters, data, plot) {
    const rawData     = plot?._rawData ?? data;
    const dataset     = rawData?.[parameters.dataset];
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
