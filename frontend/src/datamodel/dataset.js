import axios from 'axios';
import { XYZ } from './libaarhusxyz';
import { MagData } from './magdata';

const API = "http://localhost:8000";
const DB_NAME = "NagelfluhCache";
const DB_VERSION = 1;

// IndexedDB initialization
let db = null;

async function initDB() {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Create object stores
      if (!database.objectStoreNames.contains('datasets')) {
        database.createObjectStore('datasets');
      }
      if (!database.objectStoreNames.contains('data')) {
        database.createObjectStore('data');
      }
      if (!database.objectStoreNames.contains('geography')) {
        database.createObjectStore('geography');
      }
    };
  });
}

// Cache utilities with LRU eviction
async function getFromCache(storeName, key) {
  try {
    const database = await initDB();
    const transaction = database.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);

    return new Promise((resolve, reject) => {
      const getRequest = store.get(key);

      getRequest.onsuccess = () => {
        const result = getRequest.result;
        if (result) {
          // Update lastAccessed timestamp
          result.lastAccessed = Date.now();
          store.put(result, key);
          resolve(result);
        } else {
          resolve(null);
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  } catch (error) {
    console.error('Cache read error:', error);
    return null;
  }
}

async function putInCache(storeName, key, value) {
  try {
    const database = await initDB();
    await putInCacheWithRetry(database, storeName, key, value);
  } catch (error) {
    console.error('Cache write error:', error);
  }
}

async function putInCacheWithRetry(database, storeName, key, value, retries = 3) {
  const cacheEntry = {
    ...value,
    lastAccessed: Date.now(),
    size: estimateSize(value)
  };

  try {
    const transaction = database.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);

    return new Promise((resolve, reject) => {
      const putRequest = store.put(cacheEntry, key);
      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(putRequest.error);
    });
  } catch (error) {
    if (error.name === 'QuotaExceededError' && retries > 0) {
      // Evict oldest entry and retry
      await evictOldest(database);
      return putInCacheWithRetry(database, storeName, key, value, retries - 1);
    }
    throw error;
  }
}

async function evictOldest(database) {
  const stores = ['datasets', 'data', 'geography'];
  const entries = [];

  // Collect all entries with their timestamps
  for (const storeName of stores) {
    const transaction = database.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);

    await new Promise((resolve, reject) => {
      const request = store.openCursor();
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          entries.push({
            storeName,
            key: cursor.key,
            lastAccessed: cursor.value.lastAccessed || 0
          });
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  if (entries.length === 0) return;

  // Sort by lastAccessed (oldest first)
  entries.sort((a, b) => a.lastAccessed - b.lastAccessed);

  // Delete oldest entry
  const oldest = entries[0];
  const transaction = database.transaction([oldest.storeName], 'readwrite');
  const store = transaction.objectStore(oldest.storeName);

  return new Promise((resolve, reject) => {
    const deleteRequest = store.delete(oldest.key);
    deleteRequest.onsuccess = () => {
      console.log(`Evicted cache entry: ${oldest.storeName}/${oldest.key}`);
      resolve();
    };
    deleteRequest.onerror = () => reject(deleteRequest.error);
  });
}

function estimateSize(obj) {
  // Rough estimate of object size in bytes
  try {
    return JSON.stringify(obj, (key, value) => {
      // Convert BigInt to string for size estimation
      return typeof value === 'bigint' ? value.toString() : value;
    }).length;
  } catch (error) {
    // If stringify fails for any reason, return a default estimate
    console.warn('Could not estimate size:', error);
    return 1000; // Default estimate
  }
}

// Base Dataset class
export class Dataset {
  constructor(metadata) {
    this.metadata = metadata;
    this.id = metadata.id;
    this.mimeType = metadata.mime_type;
    this.parts = metadata.parts || {};

    // In-memory cache (fallback if IndexedDB fails)
    this._geographyCache = {};
  }

  getParts() {
    const partPaths = [];

    const traverse = (obj, prefix = '') => {
      for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}/${key}` : key;
        partPaths.push(path);

        if (value.parts) {
          traverse(value.parts, path);
        }
      }
    };

    traverse(this.parts);
    return partPaths;
  }

  _getPartMetadata(partPath) {
    if (partPath === "all" || partPath === "") {
      // Root level - use top-level files
      return this.metadata;
    }

    // Navigate nested parts structure (e.g., "12/34" -> parts["12"].parts["34"])
    const segments = partPath.split('/');
    let current = this.metadata.parts;

    for (const segment of segments) {
      if (!current || !current[segment]) {
        return null;
      }
      current = current[segment];
    }

    return current;
  }

  async getGeography(partPath = "all") {
    const cacheKey = `${this.id}-${partPath}`;

    // Check IndexedDB cache
    const cached = await getFromCache('geography', cacheKey);
    if (cached && cached.geography) {
      return cached.geography;
    }

    // Check in-memory cache
    if (this._geographyCache[cacheKey]) {
      return this._geographyCache[cacheKey];
    }

    // Try to extract from "all" if we have it cached
    if (partPath !== "all") {
      const allCached = await getFromCache('geography', `${this.id}-all`);
      if (allCached && allCached.geography) {
        const extracted = this._extractPartGeography(allCached.geography, partPath);
        if (extracted) {
          this._geographyCache[cacheKey] = extracted;
          await putInCache('geography', cacheKey, { geography: extracted });
          return extracted;
        }
      }
    }

    // Try to merge parts into "all" if all parts are cached
    if (partPath === "all") {
      const partPaths = this.getParts();
      const partGeographies = [];
      let allPartsAvailable = true;

      for (const path of partPaths) {
        const partCached = await getFromCache('geography', `${this.id}-${path}`);
        if (partCached && partCached.geography) {
          partGeographies.push({ path, geography: partCached.geography });
        } else {
          allPartsAvailable = false;
          break;
        }
      }

      if (allPartsAvailable && partGeographies.length > 0) {
        const merged = this._mergePartGeographies(partGeographies);
        this._geographyCache[cacheKey] = merged;
        await putInCache('geography', cacheKey, { geography: merged });
        return merged;
      }
    }

    // Fetch from API
    const geography = await this._fetchGeography(partPath);
    this._geographyCache[cacheKey] = geography;
    await putInCache('geography', cacheKey, { geography });
    return geography;
  }

  async _fetchGeography(partPath) {
    const partMetadata = this._getPartMetadata(partPath);

    if (!partMetadata || !partMetadata.files) {
      console.error(`No metadata found for part: ${partPath}`);
      return null;
    }

    const url = partMetadata.files['application/geo+json'];
    if (!url) {
      console.error(`No application/geo+json file found for part: ${partPath}`);
      return null;
    }

    try {
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch geography from ${url}:`, error);
      return null;
    }
  }

  _extractPartGeography(allGeography, partPath) {
    if (!allGeography || !allGeography.features) return null;

    const features = allGeography.features.filter(
      feature => feature.properties && feature.properties.part === partPath
    );

    if (features.length === 0) return null;

    return {
      type: "FeatureCollection",
      features
    };
  }

  _mergePartGeographies(partGeographies) {
    const allFeatures = [];

    for (const { path, geography } of partGeographies) {
      if (geography && geography.features) {
        geography.features.forEach(feature => {
          const newFeature = { ...feature };
          if (!newFeature.properties) {
            newFeature.properties = {};
          }
          newFeature.properties.part = path;
          allFeatures.push(newFeature);
        });
      }
    }

    return {
      type: "FeatureCollection",
      features: allFeatures
    };
  }
}

// JsonDataset subclass for application/json
export class JsonDataset extends Dataset {
  constructor(metadata) {
    super(metadata);
    this._dataCache = {};
  }

  async getData(partPath = "all") {
    const cacheKey = `${this.id}-${partPath}`;

    // Check IndexedDB cache
    const cached = await getFromCache('data', cacheKey);
    if (cached && cached.data) {
      return cached.data;
    }

    // Check in-memory cache
    if (this._dataCache[cacheKey]) {
      return this._dataCache[cacheKey];
    }

    // Try to extract from "all" if we have it cached
    if (partPath !== "all") {
      const allCached = await getFromCache('data', `${this.id}-all`);
      if (allCached && allCached.data) {
        const extracted = this._extractPartData(allCached.data, partPath);
        if (extracted) {
          this._dataCache[cacheKey] = extracted;
          await putInCache('data', cacheKey, { data: extracted });
          return extracted;
        }
      }
    }

    // Try to merge parts into "all" if all parts are cached
    if (partPath === "all") {
      const partPaths = this.getParts();
      const partDatasets = [];
      let allPartsAvailable = true;

      for (const path of partPaths) {
        const partCached = await getFromCache('data', `${this.id}-${path}`);
        if (partCached && partCached.data) {
          partDatasets.push({ path, data: partCached.data });
        } else {
          allPartsAvailable = false;
          break;
        }
      }

      if (allPartsAvailable && partDatasets.length > 0) {
        const merged = this._mergePartData(partDatasets);
        this._dataCache[cacheKey] = merged;
        await putInCache('data', cacheKey, { data: merged });
        return merged;
      }
    }

    // Fetch from API
    const data = await this._fetchData(partPath);
    this._dataCache[cacheKey] = data;
    await putInCache('data', cacheKey, { data });
    return data;
  }

  async _fetchData(partPath) {
    const partMetadata = this._getPartMetadata(partPath);

    if (!partMetadata || !partMetadata.files) {
      console.error(`No metadata found for part: ${partPath}`);
      return null;
    }

    const url = partMetadata.files[this.mimeType];
    if (!url) {
      console.error(`No ${this.mimeType} file found for part: ${partPath}`);
      return null;
    }

    try {
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch data from ${url}:`, error);
      return null;
    }
  }

  _extractPartData(allData, partPath) {
    if (!allData || !allData.part) return null;

    const result = {};
    const indices = [];

    // Find indices where part matches
    allData.part.forEach((p, i) => {
      if (p === partPath) {
        indices.push(i);
      }
    });

    if (indices.length === 0) return null;

    // Extract data at those indices for all array fields
    for (const [key, value] of Object.entries(allData)) {
      if (key === 'part') continue;

      if (Array.isArray(value)) {
        result[key] = indices.map(i => value[i]);
      } else {
        result[key] = value; // Non-array fields (like units)
      }
    }

    return result;
  }

  _mergePartData(partDatasets) {
    const result = {};
    const partArray = [];

    // Collect all keys from all parts
    const allKeys = new Set();
    partDatasets.forEach(({ data }) => {
      Object.keys(data).forEach(key => allKeys.add(key));
    });

    // Merge arrays
    for (const key of allKeys) {
      const firstValue = partDatasets[0].data[key];

      if (Array.isArray(firstValue)) {
        result[key] = [];

        partDatasets.forEach(({ path, data }) => {
          if (data[key] && Array.isArray(data[key])) {
            result[key].push(...data[key]);

            // Build part array
            if (key === Object.keys(data).find(k => Array.isArray(data[k]))) {
              for (let i = 0; i < data[key].length; i++) {
                partArray.push(path);
              }
            }
          }
        });
      } else {
        // Non-array fields - use first value
        result[key] = firstValue;
      }
    }

    // Add part array
    result.part = partArray;

    return result;
  }
}

// XyzDataset subclass for application/x-aarhusxyz-msgpack
export class XyzDataset extends Dataset {
  constructor(metadata) {
    super(metadata);
    this._dataCache = {};
  }

  async getData(partPath = "all") {
    const cacheKey = `${this.id}-${partPath}`;

    // Check IndexedDB cache
    const cached = await getFromCache('data', cacheKey);
    if (cached && cached.binary) {
      // Reconstruct XYZ object from cached binary msgpack
      return new XYZ(cached.binary);
    }

    // Check in-memory cache
    if (this._dataCache[cacheKey]) {
      return this._dataCache[cacheKey];
    }

    // Note: For XYZ datasets, we don't try to extract/merge from cache
    // because the XYZ object needs to be complete for proper structure

    // Fetch from API
    const { xyzObj, binary } = await this._fetchData(partPath);
    this._dataCache[cacheKey] = xyzObj;
    // Store the raw binary msgpack for caching (avoids BigInt serialization issues)
    await putInCache('data', cacheKey, { binary: binary });
    return xyzObj;
  }

  async _fetchData(partPath) {
    const partMetadata = this._getPartMetadata(partPath);

    if (!partMetadata || !partMetadata.files) {
      console.error(`No metadata found for part: ${partPath}`);
      return null;
    }

    const url = partMetadata.files[this.mimeType];
    if (!url) {
      console.error(`No ${this.mimeType} file found for part: ${partPath}`);
      return null;
    }

    try {
      // Fetch binary msgpack
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`Failed to fetch XYZ data: ${response.statusText}`);
        return null;
      }
      const binary = await response.arrayBuffer();

      // Create XYZ object from binary
      const xyzObj = new XYZ(binary);

      return { xyzObj, binary };
    } catch (error) {
      console.error(`Failed to fetch XYZ data from ${url}:`, error);
      return null;
    }
  }
}

// MagDataset subclass for application/x-magdata-msgpack
export class MagDataset extends Dataset {
  constructor(metadata) {
    super(metadata);
    this._dataCache = {};
  }

  async getData(partPath = "all") {
    const cacheKey = `${this.id}-${partPath}`;

    // Check IndexedDB cache
    const cached = await getFromCache('data', cacheKey);
    if (cached && cached.binary) {
      // Reconstruct MagData object from cached binary msgpack
      return new MagData(cached.binary);
    }

    // Check in-memory cache
    if (this._dataCache[cacheKey]) {
      return this._dataCache[cacheKey];
    }

    // Note: Like XyzDataset, we don't try to extract/merge from cache
    // because the MagData object needs to be complete for proper structure

    // Fetch from API
    const { magDataObj, binary } = await this._fetchData(partPath);
    this._dataCache[cacheKey] = magDataObj;
    // Store the raw binary msgpack for caching
    await putInCache('data', cacheKey, { binary: binary });
    return magDataObj;
  }

  async _fetchData(partPath) {
    const partMetadata = this._getPartMetadata(partPath);

    if (!partMetadata || !partMetadata.files) {
      console.error(`No metadata found for part: ${partPath}`);
      return null;
    }

    const url = partMetadata.files[this.mimeType];
    if (!url) {
      console.error(`No ${this.mimeType} file found for part: ${partPath}`);
      return null;
    }

    try {
      // Fetch binary msgpack
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`Failed to fetch MagData: ${response.statusText}`);
        return null;
      }
      const binary = await response.arrayBuffer();

      // Create MagData object from binary
      const magDataObj = new MagData(binary);

      return { magDataObj, binary };
    } catch (error) {
      console.error(`Failed to fetch MagData from ${url}:`, error);
      return null;
    }
  }
}

// Factory function to load dataset
export async function loadDataset(id) {
  const cacheKey = id;

  // Check IndexedDB cache for metadata
  const cached = await getFromCache('datasets', cacheKey);
  if (cached && cached.metadata) {
    return createDatasetInstance(cached.metadata);
  }

  // Fetch metadata from API
  const response = await axios.get(`${API}/dataset/${id}`);
  const metadata = response.data;

  // Cache metadata
  await putInCache('datasets', cacheKey, { metadata });

  return createDatasetInstance(metadata);
}

function createDatasetInstance(metadata) {
  const mimeType = metadata.mime_type;

  if (mimeType === 'application/json') {
    return new JsonDataset(metadata);
  }

  if (mimeType === 'application/x-aarhusxyz-msgpack') {
    return new XyzDataset(metadata);
  }

  if (mimeType === 'application/x-magdata-msgpack') {
    return new MagDataset(metadata);
  }

  // Default to base Dataset for unsupported types
  return new Dataset(metadata);
}
