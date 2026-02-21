import React, { useContext, useEffect, useMemo, useRef } from 'react';
import { Plot } from 'gladly-plot';
import { ProcessContext } from '../../ProcessContext';
import { registerQuantityKinds } from './quantityKinds';
import './elements/index.js';

// Register quantity kinds once at module load
registerQuantityKinds();

const PLOT_MARGIN = { top: 50, right: 80, bottom: 60, left: 80 };

export default function PlotView({ layoutConfig, parentUpdate, id, widget, ...rest }) {
  const { fetchedData, datasetsLoading, dataLoading, currentSounding, setCurrentSounding, datasetCollection } =
    useContext(ProcessContext);

  const containerRef    = useRef(null);
  const plotRef         = useRef(null);
  const statusCoordsRef = useRef(null);   // left: live mouse coordinates
  const statusPickRef   = useRef(null);   // right: last clicked point
  const configRef       = useRef(null);   // tracks latest sanitized config for pick resolution
  const fetchedDataRef  = useRef(fetchedData);
  const lastSavedRef    = useRef(null);      // JSON of last config we sent via parentUpdate
  const parentUpdateRef = useRef(parentUpdate);
  useEffect(() => { parentUpdateRef.current = parentUpdate; }, [parentUpdate]);
  useEffect(() => { fetchedDataRef.current = fetchedData; }, [fetchedData]);

  const config = useMemo(
    () => layoutConfig || PlotView.get_default().layoutConfig,
    [layoutConfig],
  );

  // Create / destroy the Plot instance and register gladly event handlers.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const plot = new Plot(container, { margin: PLOT_MARGIN });
    plotRef.current = plot;

    // Show data-space coordinates on the left of the status bar on mousemove.
    const moveHandle = plot.on('mousemove', (e, coords) => {
      const bar = statusCoordsRef.current;
      if (!bar) return;
      // Show only quantity-kind keys (skip axis-name duplicates like xaxis_bottom).
      const parts = Object.entries(coords)
        .filter(([k]) => !k.startsWith('xaxis_') && !k.startsWith('yaxis_'))
        .map(([k, v]) => `${k}: ${Number(v).toPrecision(5)}`);
      bar.textContent = parts.join('   ');
    });

    // On click: GPU-pick the nearest point, update status bar, and set current sounding.
    const clickHandle = plot.on('click', (e, coords) => {
      const p = plotRef.current;
      if (!p) return;

      const rect   = container.getBoundingClientRect();
      const result = p.pick(e.clientX - rect.left, e.clientY - rect.top);

      // Update right side of status bar with the picked point's raw attributes.
      const pickBar = statusPickRef.current;
      if (pickBar) {
        if (result) {
          const { configLayerIndex, dataIndex, layer } = result;
          const isInstanced = layer.instanceCount !== null;
          const row = Object.fromEntries(
            Object.entries(layer.attributes)
              .filter(([k]) => !isInstanced || (layer.attributeDivisors[k] ?? 0) === 1)
              .map(([k, v]) => [k, Number(v[dataIndex]).toPrecision(5)])
          );
          pickBar.textContent =
            `layer ${configLayerIndex}  pt ${dataIndex}  ` +
            Object.entries(row).map(([k, v]) => `${k}=${v}`).join('  ');
        } else {
          pickBar.textContent = '';
        }
      }

      // --- Sounding selection ---
      if (coords.xdist_m !== undefined) {
        // x-axis is xdist_m (ChannelPlot, SoundingMarker, …): find nearest sounding.
        const data = fetchedDataRef.current;
        let xdist = null;
        for (const ds of Object.values(data)) {
          if (ds?.flightlines?.xdist) { xdist = ds.flightlines.xdist; break; }
        }
        if (xdist && xdist.length > 0) {
          let nearestIndex = 0, minDist = Math.abs(Number(xdist[0]) - coords.xdist_m);
          for (let i = 1; i < xdist.length; i++) {
            const d = Math.abs(Number(xdist[i]) - coords.xdist_m);
            if (d < minDist) { minDist = d; nearestIndex = i; }
          }
          setCurrentSounding(nearestIndex);
        }
      } else if (result) {
        // For FlightlinePlot each rendered point maps 1-to-1 to a sounding,
        // so dataIndex is the sounding index directly.
        const layerSpec = configRef.current?.layers?.[result.configLayerIndex];
        const layerTypeName = layerSpec ? Object.keys(layerSpec)[0] : null;
        if (layerTypeName === 'FlightlinePlot') {
          setCurrentSounding(result.dataIndex);
        }
      }
    });

    return () => {
      moveHandle.remove();
      clickHandle.remove();
      plot.destroy();
      plotRef.current = null;
    };
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
    configRef.current = sanitizedConfig;

    // Build a data object that exposes the gladly Data API (for ScatterLayer and
    // other gladly built-in layers) via prototype methods backed by datasetCollection,
    // while keeping the raw fetchedData entries as own properties so existing
    // custom layers (FlightlinePlot, ChannelPlot, etc.) continue to work unmodified.
    const dc = datasetCollection;
    const dataForPlot = Object.assign(
      Object.create({
        columns()          { return dc ? dc.columns() : []; },
        getData(col)       { return dc ? dc.getData(col) : undefined; },
        getQuantityKind(col) { return dc ? dc.getQuantityKind(col) : undefined; },
        getDomain(col)     { return dc ? dc.getDomain(col) : undefined; },
      }),
      fetchedData,
      { _currentSounding: currentSounding },
    );

    plot.update({
      data:   dataForPlot,
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
  }, [config, fetchedData, datasetCollection, currentSounding, datasetsLoading, dataLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="h-100 d-flex flex-column">
      <div className="flex-grow-1" style={{ position: 'relative', minHeight: 0 }}>
        <div
          ref={containerRef}
          style={{ width: '100%', height: '100%' }}
        />
        {(datasetsLoading || dataLoading) && (
          <div className="d-flex align-items-center justify-content-center"
               style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.85)' }}>
            {datasetsLoading ? 'Loading datasets…' : 'Loading data…'}
          </div>
        )}
      </div>
      <div style={{
        display: 'flex',
        fontSize: '12px',
        fontFamily: 'monospace',
        background: '#f8f9fa',
        borderTop: '1px solid #dee2e6',
        flexShrink: 0,
        minHeight: '20px',
        color: '#495057',
        overflow: 'hidden',
      }}>
        <div ref={statusCoordsRef} style={{ flex: '0 1 auto', padding: '2px 8px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} />
        <div ref={statusPickRef}   style={{ flex: '1 1 0', padding: '2px 8px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textAlign: 'right', borderLeft: '1px solid #dee2e6' }} />
      </div>
    </div>
  );
}

PlotView.title = 'Plot view';

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

PlotView.get_schema = (data_context = {}) => {
  // Build a schema-data object that satisfies two consumers simultaneously:
  //  - gladly built-in layers (ScatterLayer): need the gladly Data API
  //    (columns/getData/getQuantityKind/getDomain) on the object so Data.wrap()
  //    passes it through and enumerates real dataset columns.
  //  - custom layer schemas (ResistivityCurtain etc.): call datasetProp(data)
  //    which needs data.processes to enumerate dataset output names.
  const dc = data_context.datasetCollection;
  const schemaData = dc
    ? Object.assign(Object.create(dc), { processes: data_context.processes })
    : data_context;
  const gladlySchema = Plot.schema(schemaData);

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

PlotView.get_default = () => ({
  layoutConfig: { layers: [], axes: {} },
});
