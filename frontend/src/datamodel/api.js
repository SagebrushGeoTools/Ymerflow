import axios from 'axios';

// API URL from environment variable, fallback to localhost for development.
// In production (nginx proxy mode) this is set to "/api" at build time.
export const API = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

// Absolute HTTP base URL — needed when API is a relative path (prod nginx proxy mode).
export const ABSOLUTE_API = API.startsWith('http')
  ? API
  : `${window.location.protocol}//${window.location.host}${API}`;

// WebSocket base URL.
// When API is an absolute URL (dev), derive by replacing http→ws.
// When API is a relative path (prod nginx proxy), use window.location host.
const _wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
export const WS_API = API.startsWith('http')
  ? API.replace(/^http/, 'ws')
  : `${_wsProto}://${window.location.host}`;

const apiClient = axios.create({
  baseURL: API,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Authentication functions
export function setAuthToken(token) {
  if (token) {
    apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete apiClient.defaults.headers.common['Authorization'];
  }
}

// Synchronous init: set token before any React render so reload doesn't race with useEffect
const _initialToken = localStorage.getItem('auth_token');
if (_initialToken) {
  setAuthToken(_initialToken);
}

export async function login(username, password) {
  const response = await apiClient.post('/auth/login', { username, password });
  return response.data;
}

export async function signup(username, password, email = null) {
  const body = { username, password };
  if (email) body.email = email;
  const response = await apiClient.post('/auth/signup', body);
  return response.data;
}

export async function getInviteInfo(token) {
  const response = await apiClient.get(`/auth/invites/${token}`);
  return response.data;
}

export async function acceptInvite(token) {
  const response = await apiClient.post(`/auth/invites/${token}/accept`);
  return response.data;
}

export async function getProjectMembers(projectId) {
  const response = await apiClient.get(`/projects/${projectId}/members`);
  return response.data;
}

export async function getProjectInvites(projectId) {
  const response = await apiClient.get(`/projects/${projectId}/invites`);
  return response.data;
}

export async function createProjectInvite(projectId, email) {
  const response = await apiClient.post(`/projects/${projectId}/invites`, { email });
  return response.data;
}

export async function cancelProjectInvite(projectId, inviteId) {
  const response = await apiClient.delete(`/projects/${projectId}/invites/${inviteId}`);
  return response.data;
}

export async function leaveProject(projectId) {
  const response = await apiClient.delete(`/projects/${projectId}/members/me`);
  return response.data;
}

export async function getApiKeys() {
  const response = await apiClient.get('/auth/api-keys');
  return response.data;
}

export async function createApiKey(label, projectId, expiresAt = null) {
  const body = { label, project_id: projectId };
  if (expiresAt) body.expires_at = expiresAt;
  const response = await apiClient.post('/auth/api-keys', body);
  return response.data;
}

export async function deleteApiKey(keyId) {
  const response = await apiClient.delete(`/auth/api-keys/${keyId}`);
  return response.data;
}

export async function forgotPassword(email) {
  const response = await apiClient.post('/auth/forgot-password', { email });
  return response.data;
}

export async function getUserAccount() {
  const response = await apiClient.get('/auth/account');
  return response.data;
}

export async function updateUserPreferences(preferences) {
  const response = await apiClient.put('/auth/account/preferences', preferences);
  return response.data;
}

export async function getProjects() {
  const response = await apiClient.get('/projects');
  return response.data;
}

export async function getResourceLimits() {
  const response = await apiClient.get('/utilities/resource-limits');
  return response.data;
}

export async function createProject(name) {
  const response = await apiClient.post('/projects', { name });
  return response.data;
}

export async function getEnvironments() {
  const response = await apiClient.get('/environments', { params: { include_schemas: true } });
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

export async function cancelProcessVersion(processId, version) {
  const response = await apiClient.post(`/process/${processId}/versions/${version}/cancel`);
  return response.data;
}

export async function updateProcessPosition(processId, x, y) {
  await apiClient.patch(`/process/${processId}/position`, { x, y });
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
    // Extract dataset ID from URL (supports both old and new formats)
    let datasetId;
    if (url.includes('/datasets/')) {
      // New format: /files/.../datasets/{id}/...
      const match = url.match(/\/datasets\/([^/]+)\//);
      if (match) {
        datasetId = match[1];
      }
    } else {
      // Old format: /dataset/{id}
      datasetId = url.split('/').pop();
    }

    if (datasetId) {
      const dataset = await getDataset(datasetId);
      return dataset;
    }
    return null;
  });

  const results = await Promise.all(datasetPromises);
  return results.filter(ds => ds !== null);
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

// Upload a file
export async function uploadFile(file, onProgress, projectId = null) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await apiClient.post('/upload', formData, {
    params: projectId ? { project_id: projectId } : {},
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    onUploadProgress: (progressEvent) => {
      if (onProgress && progressEvent.lengthComputable) {
        const percentComplete = (progressEvent.loaded / progressEvent.total) * 100;
        onProgress(percentComplete);
      }
    }
  });

  return response.data;
}

export async function getProjectTags(projectId) {
  const response = await apiClient.get(`/projects/${projectId}/tags`);
  return response.data;
}

export async function createProjectTag(projectId, tag) {
  const response = await apiClient.post(`/projects/${projectId}/tags`, tag);
  return response.data;
}

export async function updateProjectTag(projectId, tagId, tag) {
  const response = await apiClient.put(`/projects/${projectId}/tags/${tagId}`, tag);
  return response.data;
}

export async function deleteProjectTag(projectId, tagId) {
  const response = await apiClient.delete(`/projects/${projectId}/tags/${tagId}`);
  return response.data;
}

export async function addVersionTag(processId, version, tagId) {
  const response = await apiClient.post(`/process/${processId}/versions/${version}/tags/${tagId}`);
  return response.data;
}

export async function removeVersionTag(processId, version, tagId) {
  const response = await apiClient.delete(`/process/${processId}/versions/${version}/tags/${tagId}`);
  return response.data;
}

// Plugin functions
export async function getPlugins() {
  const response = await apiClient.get('/plugins');
  return response.data;
}

export async function getMyPlugins() {
  const response = await apiClient.get('/plugins/me');
  return response.data;
}

export async function enablePlugin(pluginId) {
  const response = await apiClient.post(`/plugins/${pluginId}/enable`);
  return response.data;
}

export async function disablePlugin(pluginId) {
  const response = await apiClient.post(`/plugins/${pluginId}/disable`);
  return response.data;
}

export async function upgradePlugin(pluginId) {
  const response = await apiClient.post(`/plugins/${pluginId}/upgrade`);
  return response.data;
}

// Start a build_frontend_plugin Process for an npm source package. Returns { id, versions:[{version}] }.
export async function buildPlugin({ projectId, environmentId, npmName, npmVersion, name }) {
  const response = await apiClient.post('/plugins/build', {
    project_id: projectId,
    environment_id: environmentId,
    npm_name: npmName,
    npm_version: npmVersion,
    name,
  });
  return response.data;
}

// Register a completed build's output dataset as a Plugin/PluginVersion.
export async function registerPlugin({ processId, processVersion, scope = 'user', displayName, description }) {
  const response = await apiClient.post('/plugins', {
    process_id: processId,
    process_version: processVersion,
    scope,
    display_name: displayName,
    description,
  });
  return response.data;
}

// Fetch a single process (used to poll a build to completion).
export async function getProcess(processId) {
  const response = await apiClient.get(`/process/${processId}`);
  return response.data;
}

// Workspace functions
export async function getWorkspaces() {
  const response = await apiClient.get('/workspaces');
  return response.data;
}

export async function getWorkspace(workspaceId) {
  const response = await apiClient.get(`/workspace/${workspaceId}`);
  return response.data;
}

export async function saveWorkspace(workspace) {
  const response = await apiClient.post('/workspace', workspace);
  return response.data;
}

export async function deleteWorkspace(workspaceId) {
  const response = await apiClient.delete(`/workspace/${workspaceId}`);
  return response.data;
}
