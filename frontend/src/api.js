const API = "http://localhost:8000";

export async function getProcessTypes() {
  return fetch(`${API}/process-types`).then(r => r.json());
}

export async function getProcesses() {
  return fetch(`${API}/processes`).then(r => r.json());
}

export async function createProcess(proc) {
  return fetch(`${API}/process`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(proc)
  }).then(r => r.json());
}

export async function getDataset(datasetId) {
  return fetch(`${API}/dataset/${datasetId}`).then(r => r.json());
}

export async function searchDatasets(search = "", completedOnly = true) {
  return fetch(`${API}/datasets?search=${encodeURIComponent(search)}&completed_only=${completedOnly}`).then(r => r.json());
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
