import React, { useContext, useState, useEffect, useRef } from "react";
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet';
import L from 'leaflet';
import { ProcessContext } from '../ProcessContext';
import { useProcessOutputDatasets } from "../datamodel/useQueries";
import { loadDataset } from '../datamodel/dataset';
import 'leaflet/dist/leaflet.css';

/**
 * Map elements registry
 * Each element has:
 * - parameters (with schema)
 * - render: function({params, geography, currentPart}) => layer config
 */
const MAP_ELEMENTS = {
  GeoJSON: {
    parameters: {
      dataset: { type: "string" },
      defaultColor: { type: "string", default: "blue" },
      highlightColor: { type: "string", default: "red" },
      opacity: { type: "number", default: 0.6 }
    },
    render: ({ params, geography, currentPart }) => {
      if (!geography || !geography.features) return null;

      return {
        data: geography,
        style: (feature) => {
          const featurePart = feature.properties?.part;
          const isHighlighted = featurePart === currentPart;

          return {
            color: isHighlighted ? params.highlightColor : params.defaultColor,
            weight: isHighlighted ? 3 : 2,
            opacity: params.opacity,
            fillOpacity: isHighlighted ? params.opacity : params.opacity * 0.5
          };
        },
        pointToLayer: (feature, latlng) => {
          return L.circleMarker(latlng, {
            radius: 6
          });
        },
        onEachFeature: (feature, layer) => {
          if (feature.properties) {
            const props = Object.entries(feature.properties)
              .map(([key, value]) => `${key}: ${value}`)
              .join('<br/>');
            layer.bindPopup(props);
          }
        }
      };
    }
  }
};

export default function MapView({ layoutConfig, ...props }) {
  const { activeProcess, processes, currentPart } = useContext(ProcessContext);

  // Find the actual process object from activeProcess
  const process = activeProcess ? processes.find(p => p.id === activeProcess.processId) : null;
  const version = activeProcess?.version;

  const { data: datasets = [], isLoading } = useProcessOutputDatasets(process, version);

  // State for fetched geography and dataset objects
  const [fetchedGeography, setFetchedGeography] = useState({});
  const [datasetObjects, setDatasetObjects] = useState({});
  const [dataLoading, setDataLoading] = useState(false);
  const mapRef = useRef(null);

  // Load dataset objects
  useEffect(() => {
    const loadDatasets = async () => {
      const newDatasetObjects = {};

      for (const dataset of datasets) {
        try {
          const datasetObj = await loadDataset(dataset.id);
          newDatasetObjects[dataset.dataset_name] = datasetObj;
        } catch (error) {
          console.error(`Failed to load dataset ${dataset.dataset_name}:`, error);
        }
      }

      setDatasetObjects(newDatasetObjects);
    };

    if (datasets.length > 0) {
      loadDatasets();
    }
  }, [datasets]);

  // Fetch geography for "all" part (to show everything with highlighting)
  useEffect(() => {
    const fetchGeography = async () => {
      setDataLoading(true);
      const newFetchedGeography = {};

      for (const [datasetName, datasetObj] of Object.entries(datasetObjects)) {
        try {
          // Always fetch "all" to show complete geography
          const geography = await datasetObj.getGeography("all");
          newFetchedGeography[datasetName] = geography;
        } catch (error) {
          console.error(`Failed to fetch geography for ${datasetName}:`, error);
        }
      }

      setFetchedGeography(newFetchedGeography);
      setDataLoading(false);
    };

    if (Object.keys(datasetObjects).length > 0) {
      fetchGeography();
    }
  }, [datasetObjects]);

  // Zoom to fit geography when dataset changes
  useEffect(() => {
    if (mapRef.current && Object.keys(fetchedGeography).length > 0) {
      const map = mapRef.current;

      // Collect all features from all datasets
      const allFeatures = [];
      Object.values(fetchedGeography).forEach(geography => {
        if (geography && geography.features) {
          allFeatures.push(...geography.features);
        }
      });

      if (allFeatures.length > 0) {
        // Create a temporary GeoJSON layer to calculate bounds
        const tempLayer = L.geoJSON({
          type: "FeatureCollection",
          features: allFeatures
        });

        const bounds = tempLayer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [50, 50] });
        }
      }
    }
  }, [fetchedGeography]);

  // Use layoutConfig from props with fallback to default
  const config = layoutConfig || MapView.get_default({ datasets }).layoutConfig;

  return (
    <div className="h-100 d-flex flex-column">
      <div className="flex-grow-1" style={{ position: 'relative' }}>
        {isLoading || dataLoading ? (
          <div className="d-flex align-items-center justify-content-center h-100">
            {isLoading ? "Loading datasets..." : "Loading geography..."}
          </div>
        ) : (
          <MapContainer
            ref={mapRef}
            center={[0, 0]}
            zoom={2}
            style={{ width: "100%", height: "100%" }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {config.elements && config.elements.map((el, idx) => {
              const def = MAP_ELEMENTS[el.type];
              const geography = fetchedGeography[el.params.dataset];

              if (!geography || !def) return null;

              const layerConfig = def.render({
                params: el.params,
                geography,
                currentPart
              });

              if (!layerConfig) return null;

              return (
                <GeoJSON
                  key={`${el.params.dataset}-${idx}-${currentPart}`}
                  data={layerConfig.data}
                  style={layerConfig.style}
                  pointToLayer={layerConfig.pointToLayer}
                  onEachFeature={layerConfig.onEachFeature}
                />
              );
            })}
          </MapContainer>
        )}
      </div>
    </div>
  );
}

MapView.title = "Map view";

MapView.get_schema = (data_context = {}) => {
  const datasets = data_context.datasets || [];
  const datasetNames = datasets.map(d => d.dataset_name);

  return {
    type: "object",
    properties: {
      id: {
        type: "string",
        title: "ID",
        readOnly: true
      },
      widget: {
        type: "string",
        title: "Widget Type",
        readOnly: true
      },
      layoutConfig: {
        type: "object",
        title: "Map Configuration",
        properties: {
          elements: {
            type: "array",
            title: "Map Elements",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["GeoJSON"],
                  title: "Element Type"
                },
                params: {
                  type: "object",
                  title: "Parameters",
                  properties: {
                    dataset: datasetNames.length > 0
                      ? { type: "string", enum: datasetNames, title: "Dataset" }
                      : { type: "string", title: "Dataset" },
                    defaultColor: { type: "string", title: "Default Color", default: "blue" },
                    highlightColor: { type: "string", title: "Highlight Color", default: "red" },
                    opacity: { type: "number", title: "Opacity", default: 0.6, minimum: 0, maximum: 1 }
                  }
                }
              }
            }
          }
        }
      }
    },
    required: ["layoutConfig"]
  };
};

MapView.get_default = (data_context = {}) => {
  const datasets = data_context.datasets || [];

  // Try to find "output" dataset, otherwise use first dataset, or default to "output"
  let targetDataset = "output";
  const outputDataset = datasets.find(d => d.dataset_name === "output");
  if (outputDataset) {
    targetDataset = outputDataset.dataset_name;
  } else if (datasets.length > 0) {
    targetDataset = datasets[0].dataset_name;
  }

  return {
    layoutConfig: {
      elements: [
        {
          type: "GeoJSON",
          params: {
            dataset: targetDataset,
            defaultColor: "red",
            highlightColor: "darkred",
            opacity: 0.6
          }
        }
      ]
    }
  };
};
