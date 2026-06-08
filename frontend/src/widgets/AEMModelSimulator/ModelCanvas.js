import React, { useRef, useEffect, useState } from 'react';
import { calculateLayerDepths, calculateElevationRange, findNearestSounding } from './utils/geometry';
import { paintWithBrush } from './utils/painting';
import { applyRubberbandEffect, findClosestPointOnLine } from './utils/rubberband';
import { getColor } from './utils/colormaps';

// Calculate nice tick spacing
function calculateNiceTicks(min, max, targetCount = 5) {
  const range = max - min;
  const roughStep = range / targetCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude;

  let niceStep;
  if (normalized < 1.5) niceStep = 1;
  else if (normalized < 3) niceStep = 2;
  else if (normalized < 7) niceStep = 5;
  else niceStep = 10;

  const step = niceStep * magnitude;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  const ticks = [];
  for (let v = niceMin; v <= niceMax; v += step) {
    if (v >= min && v <= max) {
      ticks.push(v);
    }
  }
  return ticks;
}

function ModelCanvas({
  modelData,
  setModelData,
  brushRadius,
  brushSharpness,
  currentResistivity,
  drawMode,
  rubberbandWidth,
  vmin,
  vmax,
  colormap,
  customColormapData,
}) {
  const canvasRef = useRef(null);
  const [dragging, setDragging] = useState(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

  // Pan and zoom state
  const [viewport, setViewport] = useState({
    offsetX: 0,
    offsetY: 0,
    scale: 1
  });

  // Margins for axes
  const margins = { left: 60, right: 20, top: 20, bottom: 50 };

  // Calculate derived geometry
  const layerDepths = calculateLayerDepths(modelData.config.layerThicknesses);
  const elevRange = calculateElevationRange(
    modelData.topo.concat(modelData.flightElevation),
    modelData.config.layerThicknesses
  );

  // Data bounds
  const xMin = 0;
  const xMax = modelData.xdist[modelData.xdist.length - 1];
  const yMin = elevRange.min - 10;
  const yMax = elevRange.max + 10;

  // Plot area dimensions
  const plotWidth = canvasSize.width - margins.left - margins.right;
  const plotHeight = canvasSize.height - margins.top - margins.bottom;

  // Coordinate conversion with viewport transform
  const xToCanvas = (x) => {
    return margins.left + ((x - xMin) / (xMax - xMin)) * plotWidth * viewport.scale + viewport.offsetX;
  };

  const yToCanvas = (y) => {
    return margins.top + plotHeight - ((y - yMin) / (yMax - yMin)) * plotHeight * viewport.scale - viewport.offsetY;
  };

  const canvasToX = (cx) => {
    return ((cx - margins.left - viewport.offsetX) / (plotWidth * viewport.scale)) * (xMax - xMin) + xMin;
  };

  const canvasToY = (cy) => {
    return yMin + (yMax - yMin) * (margins.top + plotHeight - cy - viewport.offsetY) / (plotHeight * viewport.scale);
  };

  // Handle canvas resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateSize = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      setCanvasSize({ width: rect.width, height: rect.height });
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(canvas.parentElement);

    return () => resizeObserver.disconnect();
  }, []);

  // Attach wheel event listener with passive: false to allow preventDefault
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e) => {
      e.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Zoom factor
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.1, Math.min(10, viewport.scale * zoomFactor));

      // Zoom towards mouse position - keep the point under mouse stationary
      const scaleRatio = newScale / viewport.scale;
      const newOffsetX = mouseX - (mouseX - viewport.offsetX) * scaleRatio;
      const newOffsetY = mouseY - (mouseY - viewport.offsetY) * scaleRatio;

      setViewport({
        scale: newScale,
        offsetX: newOffsetX,
        offsetY: newOffsetY
      });
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [viewport]);

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;

    // Clear
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

    // Save context for clipping
    ctx.save();
    ctx.beginPath();
    ctx.rect(margins.left, margins.top, plotWidth, plotHeight);
    ctx.clip();

    // Draw resistivity grid
    const nSoundings = modelData.xdist.length;
    const nLayers = modelData.resistivity.length;

    for (let si = 0; si < nSoundings - 1; si++) {
      for (let li = 0; li < nLayers; li++) {
        const x1 = xToCanvas(modelData.xdist[si]);
        const x2 = xToCanvas(modelData.xdist[si + 1]);

        const topElev1 = modelData.topo[si] - layerDepths[li];
        const botElev1 = modelData.topo[si] - layerDepths[li + 1];
        const topElev2 = modelData.topo[si + 1] - layerDepths[li];
        const botElev2 = modelData.topo[si + 1] - layerDepths[li + 1];

        const y1Top = yToCanvas(topElev1);
        const y1Bot = yToCanvas(botElev1);
        const y2Top = yToCanvas(topElev2);
        const y2Bot = yToCanvas(botElev2);

        // Use average resistivity for this cell
        const res = (modelData.resistivity[li][si] + modelData.resistivity[li][si + 1]) / 2;
        ctx.fillStyle = getColor(res, vmin, vmax, colormap === 'custom' ? customColormapData : colormap);

        // Draw quadrilateral
        ctx.beginPath();
        ctx.moveTo(x1, y1Top);
        ctx.lineTo(x2, y2Top);
        ctx.lineTo(x2, y2Bot);
        ctx.lineTo(x1, y1Bot);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Draw grid lines (layer boundaries)
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    for (let li = 0; li <= nLayers; li++) {
      ctx.beginPath();
      for (let si = 0; si < nSoundings; si++) {
        const x = xToCanvas(modelData.xdist[si]);
        const elev = modelData.topo[si] - layerDepths[li];
        const y = yToCanvas(elev);
        if (si === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Draw topography line
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let si = 0; si < nSoundings; si++) {
      const x = xToCanvas(modelData.xdist[si]);
      const y = yToCanvas(modelData.topo[si]);
      if (si === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw flight path elevation line (red dashed)
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    for (let si = 0; si < nSoundings; si++) {
      const x = xToCanvas(modelData.xdist[si]);
      const y = yToCanvas(modelData.flightElevation[si]);  // ELEVATION, not altitude
      if (si === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Restore context (remove clipping)
    ctx.restore();

    // Draw axes
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.fillStyle = '#000000';
    ctx.font = '12px sans-serif';

    // X-axis
    ctx.beginPath();
    ctx.moveTo(margins.left, margins.top + plotHeight);
    ctx.lineTo(margins.left + plotWidth, margins.top + plotHeight);
    ctx.stroke();

    // Y-axis
    ctx.beginPath();
    ctx.moveTo(margins.left, margins.top);
    ctx.lineTo(margins.left, margins.top + plotHeight);
    ctx.stroke();

    // X-axis ticks and labels
    const xTicks = calculateNiceTicks(xMin, xMax, 8);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    xTicks.forEach(val => {
      const x = xToCanvas(val);
      if (x >= margins.left && x <= margins.left + plotWidth) {
        ctx.beginPath();
        ctx.moveTo(x, margins.top + plotHeight);
        ctx.lineTo(x, margins.top + plotHeight + 5);
        ctx.stroke();
        ctx.fillText(val.toFixed(0), x, margins.top + plotHeight + 8);
      }
    });

    // X-axis label
    ctx.fillText('Distance (m)', margins.left + plotWidth / 2, canvasSize.height - 10);

    // Y-axis ticks and labels
    const yTicks = calculateNiceTicks(yMin, yMax, 8);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    yTicks.forEach(val => {
      const y = yToCanvas(val);
      if (y >= margins.top && y <= margins.top + plotHeight) {
        ctx.beginPath();
        ctx.moveTo(margins.left - 5, y);
        ctx.lineTo(margins.left, y);
        ctx.stroke();
        ctx.fillText(val.toFixed(0), margins.left - 8, y);
      }
    });

    // Y-axis label
    ctx.save();
    ctx.translate(15, margins.top + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('Elevation (m)', 0, 0);
    ctx.restore();

  }, [modelData, canvasSize, layerDepths, elevRange, viewport, vmin, vmax, colormap, customColormapData]);

  // Helper functions for mouse interactions
  const handlePaint = (canvasX, canvasY) => {
    const x = canvasToX(canvasX);
    const y = canvasToY(canvasY);

    const newResistivity = modelData.resistivity.map(layer => [...layer]);

    paintWithBrush(
      newResistivity,
      modelData.xdist,
      modelData.topo,
      layerDepths,
      x,
      y,
      currentResistivity,
      brushRadius,
      brushSharpness
    );

    setModelData({
      ...modelData,
      resistivity: newResistivity
    });
  };

  const handleDragTopo = (canvasX, canvasY) => {
    const x = canvasToX(canvasX);
    const newElev = canvasToY(canvasY);

    // Find nearest sounding using actual xdist values
    const soundingIdx = findNearestSounding(x, modelData.xdist);

    const newTopo = [...modelData.topo];
    applyRubberbandEffect(newTopo, soundingIdx, newElev, rubberbandWidth);

    setModelData({
      ...modelData,
      topo: newTopo
    });
  };

  const handleDragFlightElevation = (canvasX, canvasY) => {
    const x = canvasToX(canvasX);
    const newElevation = canvasToY(canvasY);

    // Find nearest sounding using actual xdist values
    const soundingIdx = findNearestSounding(x, modelData.xdist);

    const newFlightElevation = [...modelData.flightElevation];
    applyRubberbandEffect(newFlightElevation, soundingIdx, newElevation, rubberbandWidth);

    setModelData({
      ...modelData,
      flightElevation: newFlightElevation  // ELEVATION, not altitude
    });
  };

  // Mouse event handlers
  const handleMouseDown = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    // Check for pan mode (shift key or middle button)
    if (e.shiftKey || e.button === 1) {
      e.preventDefault(); // Prevent default middle-click behavior
      setDragging({ type: 'pan', startX: canvasX, startY: canvasY });
      return;
    }

    // Check if within plot area
    if (canvasX < margins.left || canvasX > margins.left + plotWidth ||
        canvasY < margins.top || canvasY > margins.top + plotHeight) {
      return;
    }

    if (drawMode === 'terrain') {
      // Check if clicking on topography line
      const topoHit = findClosestPointOnLine(
        canvasX,
        canvasY,
        modelData.xdist,
        modelData.topo,
        xToCanvas,
        yToCanvas,
        15
      );

      if (topoHit) {
        setDragging({ type: 'topo', index: topoHit.index });
        return;
      }

      // Check if clicking on flight elevation line
      const elevHit = findClosestPointOnLine(
        canvasX,
        canvasY,
        modelData.xdist,
        modelData.flightElevation,
        xToCanvas,
        yToCanvas,
        15
      );

      if (elevHit) {
        setDragging({ type: 'flightElevation', index: elevHit.index });
        return;
      }
    } else if (drawMode === 'paint') {
      // Start painting
      setDragging({ type: 'paint' });
      handlePaint(canvasX, canvasY);
    }
  };

  const handleMouseMove = (e) => {
    if (!dragging) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    if (dragging.type === 'pan') {
      const dx = canvasX - dragging.startX;
      const dy = canvasY - dragging.startY;
      setViewport(v => ({
        ...v,
        offsetX: v.offsetX + dx,
        offsetY: v.offsetY - dy  // Invert Y so drag up moves content up
      }));
      setDragging({ ...dragging, startX: canvasX, startY: canvasY });
    } else if (dragging.type === 'paint') {
      handlePaint(canvasX, canvasY);
    } else if (dragging.type === 'topo') {
      handleDragTopo(canvasX, canvasY);
    } else if (dragging.type === 'flightElevation') {
      handleDragFlightElevation(canvasX, canvasY);
    }
  };

  const handleMouseUp = () => {
    setDragging(null);
  };

  const getCursor = () => {
    if (dragging?.type === 'pan') return 'grabbing';
    if (drawMode === 'paint') return 'crosshair';
    if (drawMode === 'terrain') return 'pointer';
    return 'default';
  };

  return (
    <canvas
      ref={canvasRef}
      style={{
        cursor: getCursor(),
        width: '100%',
        height: '100%'
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

export default ModelCanvas;
