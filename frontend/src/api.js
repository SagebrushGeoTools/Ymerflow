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

export async function getDatasets(pid) {
  return fetch(`${API}/datasets/${pid}`).then(r => r.json());
}
