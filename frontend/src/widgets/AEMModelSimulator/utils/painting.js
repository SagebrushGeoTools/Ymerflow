import { findNearestSounding, findLayerAtElevation, calculateDistance } from './geometry';

/**
 * Apply brush painting to resistivity grid
 *
 * @param {Array} resistivity - 2D array [layer][sounding]
 * @param {Array} xdist - X positions of soundings
 * @param {Array} topo - Topography elevations
 * @param {Array} layerDepths - Cumulative layer depths
 * @param {number} targetX - X position to paint at
 * @param {number} targetElev - Elevation to paint at
 * @param {number} brushResistivity - Resistivity value to paint
 * @param {number} brushRadius - Radius of brush in data units (m)
 * @param {number} brushSharpness - Sharpness 0-1 (0=soft, 1=hard)
 */
export function paintWithBrush(
  resistivity,
  xdist,
  topo,
  layerDepths,
  targetX,
  targetElev,
  brushResistivity,
  brushRadius,
  brushSharpness
) {
  const nSoundings = xdist.length;
  const nLayers = resistivity.length;

  // Find center sounding and layer
  const centerSounding = findNearestSounding(targetX, xdist);
  const centerLayer = findLayerAtElevation(centerSounding, targetElev, topo, layerDepths);

  console.log('paintWithBrush:', { targetX, targetElev, centerSounding, centerLayer, brushRadius });

  if (centerLayer === null) {
    console.log('centerLayer is null - outside layer range');
    return; // Outside layer range
  }

  // Apply brush to nearby cells
  let cellsModified = 0;
  for (let si = 0; si < nSoundings; si++) {
    const soundingX = xdist[si];

    for (let li = 0; li < nLayers; li++) {
      // Calculate center of this cell
      const cellTopElev = topo[si] - layerDepths[li];
      const cellBotElev = topo[si] - layerDepths[li + 1];
      const cellCenterElev = (cellTopElev + cellBotElev) / 2;

      // Distance from brush center to cell center
      const dist = calculateDistance(targetX, targetElev, soundingX, cellCenterElev);

      if (dist < brushRadius) {
        // Calculate falloff weight
        const normalizedDist = dist / brushRadius;
        const weight = calculateBrushWeight(normalizedDist, brushSharpness);

        // Blend: new = old * (1-weight) + target * weight
        const oldRes = resistivity[li][si];
        resistivity[li][si] = oldRes * (1 - weight) + brushResistivity * weight;
        cellsModified++;
      }
    }
  }
  console.log('Cells modified:', cellsModified);
}

/**
 * Calculate brush weight based on normalized distance and sharpness
 * @param {number} normalizedDist - Distance from center, normalized to 0-1
 * @param {number} sharpness - Sharpness 0-1
 * @returns {number} Weight 0-1
 */
function calculateBrushWeight(normalizedDist, sharpness) {
  if (normalizedDist >= 1) return 0;

  // Linear interpolation between soft (quadratic) and hard (linear) falloff
  const softFalloff = 1 - normalizedDist * normalizedDist; // Quadratic (smooth)
  const hardFalloff = 1 - normalizedDist; // Linear (sharper)

  return softFalloff * (1 - sharpness) + hardFalloff * sharpness;
}
