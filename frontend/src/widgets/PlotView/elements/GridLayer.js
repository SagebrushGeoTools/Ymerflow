import { LayerType, registerLayerType, AXIS_GEOMETRY } from 'gladly-plot';
import { EXPRESSION_REF, resolveQuantityKind } from 'gladly-plot';

const X_AXES = Object.keys(AXIS_GEOMETRY).filter(a => AXIS_GEOMETRY[a].dir === 'x');
const Y_AXES = Object.keys(AXIS_GEOMETRY).filter(a => AXIS_GEOMETRY[a].dir === 'y');
const Z_AXES = Object.keys(AXIS_GEOMETRY).filter(a => AXIS_GEOMETRY[a].dir === 'z');

// Unit-cube geometry: 6 faces × 2 triangles × 3 vertices = 36 vertices.
// lx/ly/lz are local offsets in [-0.5, 0.5]; scaled by u_dx/u_dy/u_dz in the shader.
const { CUBE_LX, CUBE_LY, CUBE_LZ } = (() => {
  const V = [
    [-0.5, -0.5, -0.5], [ 0.5, -0.5, -0.5],  // 0, 1
    [-0.5,  0.5, -0.5], [ 0.5,  0.5, -0.5],  // 2, 3
    [-0.5, -0.5,  0.5], [ 0.5, -0.5,  0.5],  // 4, 5
    [-0.5,  0.5,  0.5], [ 0.5,  0.5,  0.5],  // 6, 7
  ];
  const F = [
    0,1,3, 0,3,2,  // -Z face
    4,6,7, 4,7,5,  // +Z face
    0,4,6, 0,6,2,  // -X face
    1,3,7, 1,7,5,  // +X face
    0,1,5, 0,5,4,  // -Y face
    2,6,7, 2,7,3,  // +Y face
  ];
  const lx = new Float32Array(36), ly = new Float32Array(36), lz = new Float32Array(36);
  for (let i = 0; i < 36; i++) {
    lx[i] = V[F[i]][0];
    ly[i] = V[F[i]][1];
    lz[i] = V[F[i]][2];
  }
  return { CUBE_LX: lx, CUBE_LY: ly, CUBE_LZ: lz };
})();

registerLayerType('GridLayer', new LayerType({
  name: 'GridLayer',

  getAxisConfig: function(parameters, data) {
    const xQK     = resolveQuantityKind(parameters.xData,     data);
    const yQK     = resolveQuantityKind(parameters.yData,     data);
    const zQK     = resolveQuantityKind(parameters.zData,     data);
    const colorQK = resolveQuantityKind(parameters.colorData, data);
    const zAxis   = parameters.zAxis ?? 'zaxis_bottom_left';
    return {
      xAxis: parameters.xAxis ?? 'xaxis_bottom',
      xAxisQuantityKind: xQK ?? undefined,
      yAxis: parameters.yAxis ?? 'yaxis_left',
      yAxisQuantityKind: yQK ?? undefined,
      zAxis,
      zAxisQuantityKind: zAxis ? (zQK ?? undefined) : undefined,
      colorAxisQuantityKinds: { '': colorQK ?? parameters.colorData },
    };
  },

  vert: `#version 300 es
    precision mediump float;
    in float lx, ly, lz;
    in float cx, cy, cz;
    in float colorVal;
    uniform float u_dx, u_dy, u_dz;
    out float vVal;
    void main() {
      vVal = colorVal;
      if (!color_filter_(colorVal)) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }
      float nx_lo = normalize_axis(cx - u_dx * 0.5, xDomain, xScaleType);
      float nx_hi = normalize_axis(cx + u_dx * 0.5, xDomain, xScaleType);
      float ny_lo = normalize_axis(cy - u_dy * 0.5, yDomain, yScaleType);
      float ny_hi = normalize_axis(cy + u_dy * 0.5, yDomain, yScaleType);
      float nz_lo = normalize_axis(cz - u_dz * 0.5, zDomain, zScaleType);
      float nz_hi = normalize_axis(cz + u_dz * 0.5, zDomain, zScaleType);
      if (nx_lo < 0.0 || nx_hi > 1.0 ||
          ny_lo < 0.0 || ny_hi > 1.0 ||
          nz_lo < 0.0 || nz_hi > 1.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }
      vec3 world = vec3(cx + lx * u_dx, cy + ly * u_dy, cz + lz * u_dz);
      gl_Position = plot_pos_3d(world);
    }
  `,

  frag: `#version 300 es
    precision mediump float;
    in float vVal;
    void main() {
      if (vVal != vVal) discard;
      fragColor = map_color_(vVal);
    }
  `,

  schema: () => ({
    type: 'object',
    properties: {
      xData:     EXPRESSION_REF,
      yData:     EXPRESSION_REF,
      zData:     EXPRESSION_REF,
      colorData: EXPRESSION_REF,
      xAxis: { type: 'string', enum: X_AXES, default: 'xaxis_bottom' },
      yAxis: { type: 'string', enum: Y_AXES, default: 'yaxis_left' },
      zAxis: { type: 'string', enum: Z_AXES, default: 'zaxis_bottom_left' },
    },
    required: ['xData', 'yData', 'zData', 'colorData'],
  }),

  createLayer: function(regl, parameters, data, plot) {
    const xCol     = data.getData(parameters.xData);
    const yCol     = data.getData(parameters.yData);
    const zCol     = data.getData(parameters.zData);
    const colorCol = data.getData(parameters.colorData);
    if (!xCol || !yCol || !zCol || !colorCol) return [];

    const xArr = xCol.array, yArr = yCol.array, zArr = zCol.array, colorArr = colorCol.array;
    if (!xArr || !yArr || !zArr || !colorArr) return [];

    const xDomain     = data.getDomain(parameters.xData);
    const yDomain     = data.getDomain(parameters.yData);
    const zDomain     = data.getDomain(parameters.zData);
    const colorDomain = data.getDomain(parameters.colorData);
    if (!xDomain || !yDomain || !zDomain) return [];

    const dx = xCol.delta ?? (xDomain[1] - xDomain[0] || 1);
    const dy = yCol.delta ?? (yDomain[1] - yDomain[0] || 1);
    const dz = zCol.delta ?? (zDomain[1] - zDomain[0] || 1);

    const xQK     = resolveQuantityKind(parameters.xData,     data);
    const yQK     = resolveQuantityKind(parameters.yData,     data);
    const zQK     = resolveQuantityKind(parameters.zData,     data);
    const colorQK = resolveQuantityKind(parameters.colorData, data);

    const domains = {};
    if (xQK     && xDomain)     domains[xQK]     = xDomain;
    if (yQK     && yDomain)     domains[yQK]     = yDomain;
    if (zQK     && zDomain)     domains[zQK]     = zDomain;
    if (colorQK && colorDomain) domains[colorQK] = colorDomain;

    return [{
      attributes: {
        lx: CUBE_LX, ly: CUBE_LY, lz: CUBE_LZ,
        cx: xArr, cy: yArr, cz: zArr,
        colorVal: colorArr,
      },
      attributeDivisors: { cx: 1, cy: 1, cz: 1, colorVal: 1 },
      uniforms: { u_dx: () => dx, u_dy: () => dy, u_dz: () => dz },
      domains,
      primitive: 'triangles',
      vertexCount: 36,
      instanceCount: xArr.length,
    }];
  },
}));
