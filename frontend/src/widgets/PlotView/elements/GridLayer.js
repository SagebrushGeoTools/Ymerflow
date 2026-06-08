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

// Expand 1D coord arrays into flat cx/cy/cz arrays, iterating in the dataset's native
// dimension order so that the flat index matches the colorFlat storage order.
//
// coordsByDim[i] = 1D coord array for dataset dimension i (0=slowest, 2=fastest).
// plotAxisByDim[i] = which output (0=cx, 1=cy, 2=cz) dataset dimension i maps to.
function _meshgridOrdered(coordsByDim, plotAxisByDim) {
  const [c0, c1, c2] = coordsByDim;
  const n0 = c0.length, n1 = c1.length, n2 = c2.length;
  const count = n0 * n1 * n2;
  const cx = new Float32Array(count);
  const cy = new Float32Array(count);
  const cz = new Float32Array(count);
  const plotArrays = [cx, cy, cz];
  const out = plotAxisByDim.map(pi => plotArrays[pi]);
  let flat = 0;
  for (let i0 = 0; i0 < n0; i0++) {
    for (let i1 = 0; i1 < n1; i1++) {
      for (let i2 = 0; i2 < n2; i2++, flat++) {
        out[0][flat] = c0[i0];
        out[1][flat] = c1[i1];
        out[2][flat] = c2[i2];
      }
    }
  }
  return { cx, cy, cz, count };
}

// Compute cell spacing from a 1D coordinate array; fall back to domain range.
function _spacing(arr1D, domainRange) {
  if (arr1D.length > 1) return Math.abs(arr1D[1] - arr1D[0]);
  return domainRange ?? 1;
}

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
      colorAxisQuantityKinds: colorQK ? { '': colorQK } : {},
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

  schema: (data) => ({
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

    const xDomain     = data.getDomain(parameters.xData);
    const yDomain     = data.getDomain(parameters.yData);
    const zDomain     = data.getDomain(parameters.zData);
    const colorDomain = data.getDomain(parameters.colorData);
    if (!xDomain || !yDomain || !zDomain) return [];

    const xQK     = resolveQuantityKind(parameters.xData,     data);
    const yQK     = resolveQuantityKind(parameters.yData,     data);
    const zQK     = resolveQuantityKind(parameters.zData,     data);
    const colorQK = resolveQuantityKind(parameters.colorData, data);

    const domains = {};
    if (xQK     && xDomain)     domains[xQK]     = xDomain;
    if (yQK     && yDomain)     domains[yQK]     = yDomain;
    if (zQK     && zDomain)     domains[zQK]     = zDomain;
    if (colorQK && colorDomain) domains[colorQK] = colorDomain;

    // ── Sub-tile path: one draw call per GPU sub-tile ─────────────────────────
    // Available when the dataset provides per-sub-tile 1D coordinate arrays.
    const xArrays     = xCol.subTileArrays;
    const yArrays     = yCol.subTileArrays;
    const zArrays     = zCol.subTileArrays;
    const colorArrays = colorCol.subTileArrays;

    // Dim indices: which dataset dimension each plot axis's column comes from.
    // Defaults (0/1/2) preserve the original behaviour for non-WebxtilColumns.
    const xDimIdx = xCol.spatialDimIndex ?? 0;
    const yDimIdx = yCol.spatialDimIndex ?? 1;
    const zDimIdx = zCol.spatialDimIndex ?? 2;

    if (xArrays?.length && yArrays?.length) {
      const drawCalls = [];
      const nST = xArrays.length;
      for (let i = 0; i < nST; i++) {
        const x1D      = xArrays[i];
        const y1D      = yArrays[i];
        const z1D      = zArrays?.[i] ?? new Float32Array([0]);
        const colorFlat = colorArrays?.[i];
        if (!x1D || !y1D || !colorFlat) continue;

        // Build per-dim coord arrays and their plot-axis assignments so the
        // iteration order matches colorFlat's native storage order.
        const coordsByDim   = [null, null, null];
        const plotAxisByDim = [null, null, null];
        coordsByDim[xDimIdx]   = x1D; plotAxisByDim[xDimIdx]   = 0;
        coordsByDim[yDimIdx]   = y1D; plotAxisByDim[yDimIdx]   = 1;
        coordsByDim[zDimIdx]   = z1D; plotAxisByDim[zDimIdx]   = 2;

        const { cx, cy, cz, count } = _meshgridOrdered(coordsByDim, plotAxisByDim);
        if (count === 0) continue;

        const dx = _spacing(x1D, xDomain[1] - xDomain[0]);
        const dy = _spacing(y1D, yDomain[1] - yDomain[0]);
        const dz = _spacing(z1D, zDomain[1] - zDomain[0]);

        drawCalls.push({
          attributes: {
            lx: CUBE_LX, ly: CUBE_LY, lz: CUBE_LZ,
            cx, cy, cz,
            colorVal: colorFlat,
          },
          attributeDivisors: { cx: 1, cy: 1, cz: 1, colorVal: 1 },
          uniforms: { u_dx: () => dx, u_dy: () => dy, u_dz: () => dz },
          domains,
          primitive: 'triangles',
          vertexCount: 36,
          instanceCount: count,
        });
      }
      return drawCalls;
    }

    // ── Fallback: single merged-array draw call ───────────────────────────────
    const xArr = xCol.array, yArr = yCol.array, zArr = zCol.array, colorArr = colorCol.array;
    if (!xArr || !yArr || !zArr || !colorArr) return [];

    const dx = xCol.delta ?? (xDomain[1] - xDomain[0] || 1);
    const dy = yCol.delta ?? (yDomain[1] - yDomain[0] || 1);
    const dz = zCol.delta ?? (zDomain[1] - zDomain[0] || 1);

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
