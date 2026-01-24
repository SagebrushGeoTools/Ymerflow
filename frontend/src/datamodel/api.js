import axios from 'axios';

const API = "http://localhost:8000";

const apiClient = axios.create({
  baseURL: API,
  headers: {
    'Content-Type': 'application/json',
  },
});

export async function getProjects() {
  const response = await apiClient.get('/projects');
  return response.data;
}

export async function createProject(name) {
  const response = await apiClient.post('/projects', { name });
  return response.data;
}

export async function getEnvironments() {
  const response = await apiClient.get('/environments');
  return response.data;
}

export async function createEnvironment(env) {
  const response = await apiClient.post('/environments', env);
  return response.data;
}

export async function getEnvironmentProcessTypes(environmentId) {
  const response = await apiClient.get(`/environments/${environmentId}/process-types`);
  return response.data;
}

export async function getProcessTypes() {
  const response = await apiClient.get('/process-types');
  return response.data;
}

export async function getProcesses(projectId) {
  const response = await apiClient.get('/processes', {
    params: projectId ? { project_id: projectId } : {},
  });
  return response.data;
}

export async function createProcess(proc, projectId) {
  const response = await apiClient.post('/process', proc, {
    params: projectId ? { project_id: projectId } : {},
  });
  return response.data;
}

export async function getDataset(datasetId) {
  const response = await apiClient.get(`/dataset/${datasetId}`);
  return response.data;
}

export async function searchDatasets(search = "", completedOnly = true, projectId = null) {
  const params = {
    search,
    completed_only: completedOnly,
  };
  if (projectId) {
    params.project_id = projectId;
  }
  const response = await apiClient.get('/datasets', { params });
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

// Get data for a dataset or part
export async function getDatasetData(datasetId, partPath = "all") {
  let url;
  if (partPath === "all") {
    url = `/dataset/${datasetId}/data`;
  } else {
    url = `/dataset/${datasetId}/${partPath}/data`;
  }
  const response = await apiClient.get(url);
  return response.data;
}

// Get geography for a dataset or part
export async function getDatasetGeography(datasetId, partPath = "all") {
  let url;
  if (partPath === "all") {
    url = `/dataset/${datasetId}/geography`;
  } else {
    url = `/dataset/${datasetId}/${partPath}/geography`;
  }
  const response = await apiClient.get(url);
  return response.data;
}
