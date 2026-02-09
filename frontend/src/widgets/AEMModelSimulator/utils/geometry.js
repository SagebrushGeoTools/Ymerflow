/**
 * Calculate cumulative depths from layer thicknesses
 * Returns array of depth values (top of each layer)
 */
export function calculateLayerDepths(layerThicknesses) {
  const depths = [0];
  let cumulative = 0;
  for (let i = 0; i < layerThicknesses.length; i++) {
    cumulative += layerThicknesses[i];
    depths.push(cumulative);
  }
  return depths;
}

/**
 * Calculate elevation range for all layers and topography
 */
export function calculateElevationRange(topo, layerThicknesses) {
  const minTopo = Math.min(...topo);
  const maxTopo = Math.max(...topo);
  const totalDepth = layerThicknesses.reduce((sum, t) => sum + t, 0);

  return {
    min: minTopo - totalDepth,
    max: Math.max(maxTopo, ...topo.map((t, i) => t)) + 50, // Add padding for flight altitude
    topoMin: minTopo,
    topoMax: maxTopo
  };
}

/**
 * Find which layer a given elevation falls into at a specific sounding
 * Returns layer index or null if outside range
 */
export function findLayerAtElevation(soundingIdx, elevation, topo, layerDepths) {
  const topoElev = topo[soundingIdx];

  for (let i = 0; i < layerDepths.length - 1; i++) {
    const topElev = topoElev - layerDepths[i];
    const botElev = topoElev - layerDepths[i + 1];

    if (elevation <= topElev && elevation >= botElev) {
      return i;
    }
  }

  return null;
}

/**
 * Find nearest sounding index for a given x distance
 */
export function findNearestSounding(x, xdist) {
  if (x <= xdist[0]) return 0;
  if (x >= xdist[xdist.length - 1]) return xdist.length - 1;

  for (let i = 0; i < xdist.length - 1; i++) {
    if (x >= xdist[i] && x < xdist[i + 1]) {
      // Return closer one
      const d1 = Math.abs(x - xdist[i]);
      const d2 = Math.abs(x - xdist[i + 1]);
      return d1 < d2 ? i : i + 1;
    }
  }

  return xdist.length - 1;
}

/**
 * Calculate distance in "data space" between two points
 * Uses x distance and elevation
 */
export function calculateDistance(x1, elev1, x2, elev2) {
  const dx = x1 - x2;
  const dy = elev1 - elev2;
  return Math.sqrt(dx * dx + dy * dy);
}
