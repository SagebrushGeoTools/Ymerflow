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

// Load all datasets for a process from its outputs
export async function getProcessOutputDatasets(process) {
  if (!process.outputs) {
    return [];
  }

  const datasetPromises = Object.entries(process.outputs).map(async ([name, url]) => {
    const datasetId = url.split('/').pop();
    const dataset = await getDataset(datasetId);
    return dataset;
  });

  return Promise.all(datasetPromises);
}
