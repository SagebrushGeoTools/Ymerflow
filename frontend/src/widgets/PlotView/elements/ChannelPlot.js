import { LayerType, registerLayerType, AXIS_GEOMETRY } from 'gladly-plot';
import { datasetProp, getFrom, getKeys, toFloat32Array } from '../colorUtils.js';

const X_AXES = Object.keys(AXIS_GEOMETRY).filter(a => AXIS_GEOMETRY[a].dir === 'x');
const Y_AXES = Object.keys(AXIS_GEOMETRY).filter(a => AXIS_GEOMETRY[a].dir === 'y');

registerLayerType('ChannelPlot', new LayerType({
  name: 'ChannelPlot',

  getAxisConfig: (parameters) => ({
    xAxis: parameters.xAxis ?? 'xaxis_bottom',
    xAxisQuantityKind: 'xdist_m',
    yAxis: parameters.yAxis ?? 'yaxis_left',
    yAxisQuantityKind: 'dbdt_abs_pT',
    // suffix '' → injected GLSL helpers: map_color_(value), colorscale, color_range, color_scale_type, alpha_blend
    colorAxisQuantityKinds: { '': 'gate_index' },
  }),

  vert: `#version 300 es
    precision mediump float;
    in float x;
    in float y;
    in float gate_index;
    in float bad_segment;
    out float vGateIndex;
    out float vBadSegment;
    void main() {
      // y == NaN means this segment had an invalid (NaN/zero/inf) endpoint.
      // Both vertices carry NaN so they fall outside clip space — GPU drops the segment.
      if (y != y) {
        gl_Position = vec4(2.0, 0.0, 0.0, 1.0);
        return;
      }
      gl_Position = plot_pos(vec2(x, y));
      vGateIndex = gate_index;
      vBadSegment = bad_segment;
    }
  `,

  frag: `#version 300 es
    precision mediump float;
    uniform vec4 bad_color;
    in float vGateIndex;
    in float vBadSegment;
    void main() {
      if (vBadSegment > 0.5) {
        fragColor = gladly_apply_color(bad_color);
      } else {
        fragColor = map_color_(vGateIndex);
      }
    }
  `,

  schema: (data) => ({
    type: 'object',
    properties: {
      dataset: datasetProp(data),
      channel: { type: 'string', enum: ['Ch01', 'Ch02'], default: 'Ch01' },
      bad_color: {
        type: 'array',
        items: { type: 'number' },
        minItems: 4,
        maxItems: 4,
        default: [0.7, 0.7, 0.7, 1.0],
        description: 'RGBA color for negative, not-in-use, or invalid segments',
      },
      xAxis: { type: 'string', enum: X_AXES, default: 'xaxis_bottom' },
      yAxis: { type: 'string', enum: Y_AXES, default: 'yaxis_left' },
    },
    required: ['dataset', 'channel'],
  }),

  createLayer: function(regl, parameters, data, plot) {
    const rawData     = plot?._rawData ?? data;
    const dataset     = rawData?.[parameters.dataset];
    const flightlines = dataset?.flightlines;
    const layer_data  = dataset?.layer_data;
    if (!flightlines || !layer_data) return [];

    const xdistRaw = flightlines.xdist;
    if (!xdistRaw) return [];

    const channel   = parameters.channel || 'Ch01';
    const yDataDict = layer_data[`Gate_${channel}`];
    if (!yDataDict) return [];

    const inuseDict = layer_data[`InUse_${channel}`];
    const badColor  = parameters.bad_color ?? [0.7, 0.7, 0.7, 1.0];

    const xdist       = toFloat32Array(xdistRaw);
    const N           = xdist.length;
    const nSegs       = N - 1;
    const gateIndices = getKeys(yDataDict).sort((a, b) => a - b);

    return gateIndices.map((gateKey, idx) => {
      const yArr     = getFrom(yDataDict, gateKey);
      const inuseArr = inuseDict ? getFrom(inuseDict, gateKey) : null;

      const xs      = new Float32Array(nSegs * 2);
      const ys      = new Float32Array(nSegs * 2);
      const gateIdx = new Float32Array(nSegs * 2);
      const badSeg  = new Float32Array(nSegs * 2);

      for (let i = 0; i < nSegs; i++) {
        const abs0 = Math.abs(Number(yArr[i]));
        const abs1 = Math.abs(Number(yArr[i + 1]));

        const isInvalid = !isFinite(abs0) || abs0 <= 0 || !isFinite(abs1) || abs1 <= 0;

        const inuse0 = inuseArr ? Number(inuseArr[i])     : 1;
        const inuse1 = inuseArr ? Number(inuseArr[i + 1]) : 1;
        const isBad  = !isInvalid && (inuse0 === 0 || inuse1 === 0);

        xs[i * 2]          = xdist[i];
        xs[i * 2 + 1]      = xdist[i + 1];
        ys[i * 2]          = isInvalid ? NaN : abs0;
        ys[i * 2 + 1]      = isInvalid ? NaN : abs1;
        gateIdx[i * 2]     = idx;
        gateIdx[i * 2 + 1] = idx;
        badSeg[i * 2]      = isBad ? 1 : 0;
        badSeg[i * 2 + 1]  = isBad ? 1 : 0;
      }

      return {
        attributes: {
          x: xs,
          y: ys,
          gate_index: gateIdx,
          bad_segment: badSeg,
        },
        uniforms: { bad_color: badColor },
        domains: { gate_index: [idx, idx] },
        primitive: 'lines',
        lineWidth: 1,
      };
    });
  },
}));
