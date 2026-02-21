import React, { useContext, useState, useEffect, useMemo, useRef } from 'react';
import { Plot } from 'gladly-plot';
import { ProcessContext } from '../../ProcessContext';
import { registerQuantityKinds } from './quantityKinds';
import './elements/index.js';

// Register quantity kinds once at module load
registerQuantityKinds();

const PLOT_MARGIN = { top: 50, right: 80, bottom: 60, left: 80 };

export default function PlotViewGL({ layoutConfig, parentUpdate, id, widget, ...rest }) {
  const { fetchedData, datasetsLoading, dataLoading, currentSounding, setCurrentSounding } =
    useContext(ProcessContext);

  const [setSoundingMode, setSetSoundingMode] = useState(false);
  const containerRef      = useRef(null);
  const plotRef           = useRef(null);
  const fetchedDataRef    = useRef(fetchedData);
  const lastSavedRef      = useRef(null);   // JSON of last config we sent via parentUpdate
  const parentUpdateRef   = useRef(parentUpdate);
  useEffect(() => { parentUpdateRef.current = parentUpdate; }, [parentUpdate]);
  useEffect(() => { fetchedDataRef.current = fetchedData; }, [fetchedData]);

  const config = useMemo(
    () => layoutConfig || PlotViewGL.get_default().layoutConfig,
    [layoutConfig],
  );

  // Create / destroy the Plot instance
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const plot = new Plot(container, { margin: PLOT_MARGIN });
    plotRef.current = plot;
    return () => { plot.destroy(); plotRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update plot whenever config, data or sounding changes.
  // _currentSounding is merged into the data object so LayerTypes that need it
  // (SoundingMarker, SoundingPlot, ResistivityCurtainLines) can read it from
  // data._currentSounding in their createLayer function.
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot || datasetsLoading || dataLoading) return;

    // rjsf's anyOf merging can leave multiple layer-type keys in one layer spec;
    // gladly iterates all keys so we keep only the first non-null one per spec.
    const sanitizedConfig = {
      ...config,
      layers: (config.layers || []).map(spec => {
        if (!spec || typeof spec !== 'object') return spec;
        const validEntries = Object.entries(spec).filter(([, v]) => v != null);
        return validEntries.length <= 1 ? spec : Object.fromEntries([validEntries[0]]);
      }),
    };

    plot.update({
      data:   { ...fetchedData, _currentSounding: currentSounding },
      config: sanitizedConfig,
    });

    // Propagate the defaults-populated config back to the layout system so
    // axes, colorscales, etc. are visible in the config editor.
    const fullConfig = plot.getConfig();
    const fullConfigJson = JSON.stringify(fullConfig);
    if (fullConfigJson !== lastSavedRef.current && parentUpdateRef.current && id) {
      lastSavedRef.current = fullConfigJson;
      parentUpdateRef.current('replace', id, { id, widget, layoutConfig: fullConfig, ...rest });
    }
  }, [config, fetchedData, currentSounding, datasetsLoading, dataLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Click handler for "set sounding" mode
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !setSoundingMode) return;

    const handleClick = (event) => {
      const plot = plotRef.current;
      if (!plot) return;

      const rect  = container.getBoundingClientRect();
      const xNorm = (event.clientX - rect.left - PLOT_MARGIN.left) /
                    (rect.width - PLOT_MARGIN.left - PLOT_MARGIN.right);

      const domain = plot.axes.xaxis_bottom.getDomain();
      if (!domain) return;
      const clickedX = domain[0] + xNorm * (domain[1] - domain[0]);

      // Find nearest sounding (xdist_m axis is always linear)
      let xdist = null;
      for (const ds of Object.values(fetchedDataRef.current)) {
        if (ds?.flightlines?.xdist) { xdist = ds.flightlines.xdist; break; }
      }
      if (!xdist || xdist.length === 0) return;

      let nearestIndex = 0, minDist = Math.abs(Number(xdist[0]) - clickedX);
      for (let i = 1; i < xdist.length; i++) {
        const d = Math.abs(Number(xdist[i]) - clickedX);
        if (d < minDist) { minDist = d; nearestIndex = i; }
      }

      setCurrentSounding(nearestIndex);
      setSetSoundingMode(false);
    };

    container.addEventListener('click', handleClick);
    return () => container.removeEventListener('click', handleClick);
  }, [setSoundingMode, setCurrentSounding]);

  return (
    <div className="h-100 d-flex flex-column">
      <div className="d-flex align-items-center p-1"
           style={{ gap: 8, borderBottom: '1px solid #dee2e6', flexShrink: 0 }}>
        <button
          className={`btn btn-sm ${setSoundingMode ? 'btn-primary' : 'btn-outline-secondary'}`}
          onClick={() => setSetSoundingMode(m => !m)}
          title="Click on the plot to set the active sounding"
        >
          Set Sounding
        </button>
      </div>

      <div className="flex-grow-1" style={{ position: 'relative', minHeight: 0 }}>
        <div
          ref={containerRef}
          style={{ width: '100%', height: '100%', cursor: setSoundingMode ? 'crosshair' : 'default' }}
        />
        {(datasetsLoading || dataLoading) && (
          <div className="d-flex align-items-center justify-content-center"
               style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.85)' }}>
            {datasetsLoading ? 'Loading datasets…' : 'Loading data…'}
          </div>
        )}
      </div>
    </div>
  );
}

PlotViewGL.title = 'Plot view (GL)';

// Transform gladly's layers.items schema to be rjsf-compatible.
// Gladly uses oneOf with additionalProperties:false, which breaks rjsf because:
//  - rjsf's mergeDefaultsWithFormData() can produce objects with keys from multiple
//    variants simultaneously (one key is the selected type, others may be undefined)
//  - additionalProperties:false then makes EVERY variant fail, so oneOf finds zero matches
// Fix: use anyOf (requires ≥1 match, not exactly 1) and drop additionalProperties:false.
// rjsf's existing transformErrors in CustomForm already filters anyOf branch errors.
function makeLayersSchemaRjsfCompatible(layersItemsSchema) {
  if (!layersItemsSchema?.oneOf) return layersItemsSchema;
  const { oneOf, ...rest } = layersItemsSchema;
  return {
    ...rest,
    anyOf: oneOf.map(({ additionalProperties, ...variant }) => variant),
  };
}

PlotViewGL.get_schema = (data_context = {}) => {
  const gladlySchema = Plot.schema(data_context);

  // Patch the layers items schema in place.
  if (gladlySchema?.properties?.layers?.items) {
    gladlySchema.properties.layers.items =
      makeLayersSchemaRjsfCompatible(gladlySchema.properties.layers.items);
  }

  return {
    type: 'object',
    properties: {
      id:           { type: 'string', title: 'ID',          readOnly: true },
      widget:       { type: 'string', title: 'Widget Type', readOnly: true },
      layoutConfig: gladlySchema,
    },
    required: ['layoutConfig'],
  };
};

PlotViewGL.get_default = () => ({
  layoutConfig: { layers: [], axes: {} },
});
