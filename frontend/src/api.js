import axios from 'axios';

const API = "http://localhost:8000";

const apiClient = axios.create({
  baseURL: API,
  headers: {
    'Content-Type': 'application/json',
  },
});

export async function getProcessTypes() {
  const response = await apiClient.get('/process-types');
  return response.data;
}

export async function getProcesses() {
  const response = await apiClient.get('/processes');
  return response.data;
}

export async function createProcess(proc) {
  const response = await apiClient.post('/process', proc);
  return response.data;
}

export async function getDataset(datasetId) {
  const response = await apiClient.get(`/dataset/${datasetId}`);
  return response.data;
}

export async function searchDatasets(search = "", completedOnly = true) {
  const response = await apiClient.get('/datasets', {
    params: {
      search,
      completed_only: completedOnly,
    },
  });
  return response.data;
}

// Load all datasets for a process version from its outputs
export async function getProcessOutputDatasets(process, version) {
  if (!process || !version) return [];

  const versionObj = getProcessVersion(process, version);
  if (!versionObj?.outputs) {
    return [];
  }

  const datasetPromises = Object.entries(versionObj.outputs).map(async ([name, url]) => {
    const datasetId = url.split('/').pop();
    const dataset = await getDataset(datasetId);
    return dataset;
  });

  return Promise.all(datasetPromises);
}

// Get a specific version of a process
export function getProcessVersion(process, version) {
  if (!process || !process.versions) return null;
  return process.versions.find(v => v.version === version);
}

// Get latest version number for a process
export function getLatestVersion(process) {
  if (!process || !process.versions || process.versions.length === 0) return 1;
  return Math.max(...process.versions.map(v => v.version));
}
