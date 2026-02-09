/**
 * Apply rubber-band effect to a line array when one point is moved
 * Uses Gaussian falloff to smoothly affect neighboring points
 *
 * @param {Array} line - Array of values to modify (will be modified in place)
 * @param {number} index - Index of the point being dragged
 * @param {number} newValue - New value for the point
 * @param {number} strength - Controls how far the effect spreads (in array indices)
 */
export function applyRubberbandEffect(line, index, newValue, strength = 20) {
  const oldValue = line[index];
  const delta = newValue - oldValue;

  // Apply Gaussian falloff to neighbors
  const sigma = strength / 3; // Standard deviation

  for (let i = 0; i < line.length; i++) {
    const dist = Math.abs(i - index);
    const weight = Math.exp(-(dist * dist) / (2 * sigma * sigma));

    // Apply weighted change
    line[i] += delta * weight;
  }
}

/**
 * Find the closest point on a line to canvas coordinates
 * Returns { index, distance } or null if none close enough
 */
export function findClosestPointOnLine(canvasX, canvasY, xPositions, yPositions, xToCanvas, yToCanvas, threshold = 10) {
  let closestIdx = null;
  let closestDist = Infinity;

  for (let i = 0; i < xPositions.length; i++) {
    const cx = xToCanvas(xPositions[i]);
    const cy = yToCanvas(yPositions[i]);

    const dx = canvasX - cx;
    const dy = canvasY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < closestDist) {
      closestDist = dist;
      closestIdx = i;
    }
  }

  if (closestDist <= threshold) {
    return { index: closestIdx, distance: closestDist };
  }

  return null;
}
