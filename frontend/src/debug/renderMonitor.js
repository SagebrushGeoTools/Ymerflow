// Render frequency monitor for debugging
const renderCounts = {};
const renderTimes = {};

export function trackRender(componentName) {
  const now = Date.now();

  if (!renderCounts[componentName]) {
    renderCounts[componentName] = 0;
    renderTimes[componentName] = [];
  }

  renderCounts[componentName]++;
  renderTimes[componentName].push(now);

  // Keep only last 100 renders
  if (renderTimes[componentName].length > 100) {
    renderTimes[componentName].shift();
  }

  // Log if rendering too frequently (more than 10 times per second)
  const recentRenders = renderTimes[componentName].filter(t => now - t < 1000);
  if (recentRenders.length > 10) {
    console.warn(`[PERF WARNING] ${componentName} rendered ${recentRenders.length} times in the last second!`);
  }
}

export function getStats() {
  const stats = {};
  const now = Date.now();

  for (const [component, times] of Object.entries(renderTimes)) {
    const recentRenders = times.filter(t => now - t < 1000);
    const last5sRenders = times.filter(t => now - t < 5000);

    stats[component] = {
      total: renderCounts[component],
      lastSecond: recentRenders.length,
      last5Seconds: last5sRenders.length,
      avgPerSecond: last5sRenders.length / 5
    };
  }

  return stats;
}

// Expose to window for easy access in console
if (typeof window !== 'undefined') {
  window.getRenderStats = getStats;
}
