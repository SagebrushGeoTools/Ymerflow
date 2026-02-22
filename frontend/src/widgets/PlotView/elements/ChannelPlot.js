import { LayerType, registerLayerType } from 'gladly-plot';
import { datasetProp, getFrom, getKeys, toFloat32Array } from '../colorUtils.js';

registerLayerType('ChannelPlot', new LayerType({
  name: 'ChannelPlot',

  xAxis: 'xaxis_bottom',
  xAxisQuantityKind: 'xdist_m',
  yAxis: 'yaxis_left',
  yAxisQuantityKind: 'dbdt_abs_pT',
  colorAxisQuantityKinds: ['gate_index'],

  vert: `
    precision mediump float;
    attribute float x;
    attribute float y;
    attribute float gate_index;
    attribute float bad_segment;
    uniform vec2 xDomain;
    uniform vec2 yDomain;
    uniform float xScaleType;
    uniform float yScaleType;
    varying float vGateIndex;
    varying float vBadSegment;
    void main() {
      // y == NaN means this segment had an invalid (NaN/zero/inf) endpoint.
      // Both vertices of such a segment carry NaN, so move them outside clip
      // space — the GPU then drops the whole segment without any artifact.
      if (y != y) {
        gl_Position = vec4(2.0, 0.0, 0.0, 1.0);
        return;
      }
      float nx = normalize_axis(x, xDomain, xScaleType);
      float ny = normalize_axis(y, yDomain, yScaleType);
      gl_Position = vec4(nx * 2.0 - 1.0, ny * 2.0 - 1.0, 0.0, 1.0);
      vGateIndex = gate_index;
      vBadSegment = bad_segment;
    }
  `,

  frag: `
    precision mediump float;
    uniform int colorscale;
    uniform vec2 color_range;
    uniform float color_scale_type;
    uniform vec4 bad_color;
    varying float vGateIndex;
    varying float vBadSegment;
    void main() {
      if (vBadSegment > 0.5) {
        gl_FragColor = gladly_apply_color(bad_color);
      } else {
        gl_FragColor = map_color_s(colorscale, color_range, vGateIndex, color_scale_type, 0.0);
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

    const inuseDict = layer_data[`InUse_${channel}`];
    const badColor  = parameters.bad_color ?? [0.7, 0.7, 0.7, 1.0];

    const xdist       = toFloat32Array(xdistRaw);
    const N           = xdist.length;
    const nSegs       = N - 1;
    const gateIndices = getKeys(yDataDict).sort((a, b) => a - b);
    const nGates      = gateIndices.length;

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

        // If either endpoint is NaN, zero, or infinite, store NaN in ys for
        // BOTH vertices of this segment.  The vertex shader detects NaN via
        // (y != y) and moves both vertices outside the clip volume, so the
        // whole segment is dropped by the GPU without any artifact.
        // NaN values are also naturally skipped by gladly's domain scan
        // (NaN comparisons always return false), so the auto-domain is correct.
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
        nameMap: {
          colorscale_gate_index:       'colorscale',
          color_range_gate_index:      'color_range',
          color_scale_type_gate_index: 'color_scale_type',
        },
      };
    });
  },
}));
