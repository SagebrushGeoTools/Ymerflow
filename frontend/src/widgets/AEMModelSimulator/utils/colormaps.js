// Colormap control points: [t, r, g, b] with t in [0,1], rgb in [0,255]
const CONTROL_POINTS = {
  turbo: [
    [0.00,  48,  18,  59],
    [0.10,  61,  83, 181],
    [0.20,  26, 187, 249],
    [0.30,  34, 241, 143],
    [0.40, 140, 251,  43],
    [0.50, 225, 228,  20],
    [0.60, 254, 165,  25],
    [0.70, 239, 102,  23],
    [0.80, 204,  52,  15],
    [0.90, 156,  15,   5],
    [1.00, 122,   4,   3],
  ],
  viridis: [
    [0.000,  68,   1,  84],
    [0.143,  71,  44, 122],
    [0.286,  59,  82, 139],
    [0.429,  44, 113, 142],
    [0.571,  33, 145, 140],
    [0.714,  82, 176, 106],
    [0.857, 173, 209,  53],
    [1.000, 253, 231,  37],
  ],
  plasma: [
    [0.000,  13,   8, 135],
    [0.143,  84,   2, 163],
    [0.286, 139,  10, 165],
    [0.429, 185,  50, 137],
    [0.571, 219,  92, 104],
    [0.714, 244, 136,  73],
    [0.857, 254, 188,  43],
    [1.000, 240, 249,  33],
  ],
  inferno: [
    [0.000,   0,   0,   4],
    [0.143,  31,  12,  72],
    [0.286,  85,  15, 109],
    [0.429, 139,  34,  82],
    [0.571, 188,  55,  84],  // approximate
    [0.714, 229, 108,   2],
    [0.857, 246, 173,  52],
    [1.000, 252, 255, 164],
  ],
  magma: [
    [0.000,   0,   0,   4],
    [0.143,  28,  16,  68],
    [0.286,  79,  18, 123],
    [0.429, 129,  37, 129],
    [0.571, 181,  54, 122],
    [0.714, 229,  80, 100],
    [0.857, 251, 136,  97],
    [1.000, 252, 253, 191],
  ],
  coolwarm: [
    [0.000,  59,  76, 192],
    [0.250, 144, 178, 254],
    [0.500, 221, 221, 221],
    [0.750, 245, 145, 114],
    [1.000, 180,   4,  38],
  ],
};

function interpolate(pts, t) {
  if (t <= pts[0][0]) return [pts[0][1], pts[0][2], pts[0][3]];
  if (t >= pts[pts.length - 1][0]) {
    const p = pts[pts.length - 1];
    return [p[1], p[2], p[3]];
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, r0, g0, b0] = pts[i];
    const [t1, r1, g1, b1] = pts[i + 1];
    if (t >= t0 && t <= t1) {
      const u = (t - t0) / (t1 - t0);
      return [
        Math.round(r0 + u * (r1 - r0)),
        Math.round(g0 + u * (g1 - g0)),
        Math.round(b0 + u * (b1 - b0)),
      ];
    }
  }
  return [0, 0, 0];
}

function analyticalRGB(t, name) {
  const c = (x) => Math.max(0, Math.min(1, x));
  if (name === 'jet') {
    return [
      Math.round(c(1.5 - Math.abs(4 * t - 3)) * 255),
      Math.round(c(1.5 - Math.abs(4 * t - 2)) * 255),
      Math.round(c(1.5 - Math.abs(4 * t - 1)) * 255),
    ];
  }
  if (name === 'hot') {
    return [
      Math.round(c(t / 0.4) * 255),
      Math.round(c((t - 0.4) / 0.4) * 255),
      Math.round(c((t - 0.8) / 0.2) * 255),
    ];
  }
  if (name === 'gray') {
    const v = Math.round(t * 255);
    return [v, v, v];
  }
  return [0, 0, 0];
}

// All available named colormaps
export const COLORMAP_NAMES = [
  'turbo', 'viridis', 'plasma', 'inferno', 'magma',
  'jet', 'hot', 'gray', 'coolwarm',
];

const ANALYTICAL = new Set(['jet', 'hot', 'gray']);

function toRGB(t, colormapName) {
  if (ANALYTICAL.has(colormapName)) return analyticalRGB(t, colormapName);
  const pts = CONTROL_POINTS[colormapName];
  if (pts) return interpolate(pts, t);
  return interpolate(CONTROL_POINTS.turbo, t); // fallback
}

// Map a resistivity value to an rgb() string using log10 scaling
export function getColor(value, vmin, vmax, colormapNameOrLUT) {
  const minLog = Math.log10(Math.max(vmin, 1e-6));
  const maxLog = Math.log10(Math.max(vmax, 1e-6));
  const logVal = Math.log10(Math.max(value, 1e-6));
  const t = Math.max(0, Math.min(1, (logVal - minLog) / (maxLog - minLog)));

  let rgb;
  if (Array.isArray(colormapNameOrLUT)) {
    const idx = Math.round(t * (colormapNameOrLUT.length - 1));
    rgb = colormapNameOrLUT[Math.max(0, Math.min(idx, colormapNameOrLUT.length - 1))];
  } else {
    rgb = toRGB(t, colormapNameOrLUT || 'turbo');
  }
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

// CSS linear-gradient string for the colorbar (bottom = vmin, top = vmax)
export function getGradientCSS(colormapNameOrLUT, nStops = 24) {
  const stops = [];
  for (let i = 0; i <= nStops; i++) {
    const t = i / nStops;
    let rgb;
    if (Array.isArray(colormapNameOrLUT)) {
      const idx = Math.round(t * (colormapNameOrLUT.length - 1));
      rgb = colormapNameOrLUT[Math.max(0, Math.min(idx, colormapNameOrLUT.length - 1))];
    } else {
      rgb = toRGB(t, colormapNameOrLUT || 'turbo');
    }
    stops.push(`rgb(${rgb[0]},${rgb[1]},${rgb[2]}) ${(t * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to top, ${stops.join(', ')})`;
}

function cmykToRgb(c, m, y, k) {
  return [
    Math.round(255 * (1 - c / 255) * (1 - k / 255)),
    Math.round(255 * (1 - m / 255) * (1 - k / 255)),
    Math.round(255 * (1 - y / 255) * (1 - k / 255)),
  ];
}

function findChannel(names, header) {
  for (const name of names) {
    const idx = header.indexOf(name);
    if (idx !== -1) return idx;
  }
  return -1;
}

// Parse a Geosoft / Aarhus Workbench .tbl file.
// Supports:
//   - Header line: {R G B}, {Red Green Blue}, {C M Y K}, {Cyn Mag Yel Blk}, etc.
//   - No-header fallback: leading count line (single integer) then R G B rows
export function parseTblFile(text) {
  const allLines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (allLines.length === 0) return null;

  // --- Geosoft format: first line is {channel names} ---
  const headerMatch = allLines[0].match(/^\{(.+)\}$/);
  if (headerMatch) {
    const header = headerMatch[1].toLowerCase().split(/\s+/);
    const dataLines = allLines.slice(1);

    const cIdx = findChannel(['c', 'cyn'], header);
    const mIdx = findChannel(['m', 'mag'], header);
    const yIdx = findChannel(['y', 'yel'], header);
    const kIdx = findChannel(['k', 'blk'], header);
    const rIdx = findChannel(['r', 'red'], header);
    const gIdx = findChannel(['g', 'green'], header);
    const bIdx = findChannel(['b', 'blue'], header);

    const lut = [];
    const isCMYK = [cIdx, mIdx, yIdx, kIdx].every((i) => i !== -1);
    const isRGB  = [rIdx, gIdx, bIdx].every((i) => i !== -1);

    for (const line of dataLines) {
      const parts = line.split(/\s+/).map(Number);
      if (isCMYK && parts.length > Math.max(cIdx, mIdx, yIdx, kIdx)) {
        lut.push(cmykToRgb(parts[cIdx], parts[mIdx], parts[yIdx], parts[kIdx]));
      } else if (isRGB && parts.length > Math.max(rIdx, gIdx, bIdx)) {
        lut.push([parts[rIdx], parts[gIdx], parts[bIdx]]);
      }
    }
    return lut.length > 1 ? lut : null;
  }

  // --- Fallback: no header, optional leading count line, then R G B rows ---
  const lines = allLines.filter((l) => !l.startsWith('//') && !l.startsWith('#') && !l.startsWith('%'));
  const startIdx = lines[0].split(/\s+/).length === 1 && /^\d+$/.test(lines[0]) ? 1 : 0;

  const lut = [];
  for (let i = startIdx; i < lines.length; i++) {
    const parts = lines[i].split(/[\s,]+/).map(Number);
    if (parts.length >= 3 && parts.every((v) => !isNaN(v))) {
      const scale = parts[0] <= 1 && parts[1] <= 1 && parts[2] <= 1 ? 255 : 1;
      lut.push([Math.round(parts[0] * scale), Math.round(parts[1] * scale), Math.round(parts[2] * scale)]);
    }
  }
  return lut.length > 1 ? lut : null;
}
