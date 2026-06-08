import React, { useContext } from 'react';
import { ProcessContext } from '../ProcessContext';
import { useEnvironments } from '../datamodel/useQueries';

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g;

function toYaml(value, indent = 0) {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (/[\n:#{}&*!,[\]|>'"@`]/.test(value) || value.trim() !== value) {
      return JSON.stringify(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return '\n' + value.map(v => `${pad}- ${toYaml(v, indent + 1)}`).join('\n');
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    return '\n' + keys.map(k => {
      const v = value[k];
      const rendered = toYaml(v, indent + 1);
      if (rendered.startsWith('\n')) {
        return `${pad}${k}:${rendered}`;
      }
      return `${pad}${k}: ${rendered}`;
    }).join('\n');
  }
  return String(value);
}

function renderYamlWithLinks(yamlText) {
  const parts = [];
  let lastIndex = 0;
  let match;
  URL_PATTERN.lastIndex = 0;
  while ((match = URL_PATTERN.exec(yamlText)) !== null) {
    if (match.index > lastIndex) {
      parts.push(yamlText.slice(lastIndex, match.index));
    }
    parts.push(
      <a key={match.index} href={match[0]} target="_blank" rel="noopener noreferrer">
        {match[0]}
      </a>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < yamlText.length) {
    parts.push(yamlText.slice(lastIndex));
  }
  return parts;
}

export default function ProcessInfo() {
  const { activeProcess, processes } = useContext(ProcessContext);
  const { data: environments = [] } = useEnvironments();

  if (!activeProcess) {
    return (
      <div className="p-3">
        <p className="text-muted">No process selected.</p>
      </div>
    );
  }

  const process = processes.find(p => p.id === activeProcess.processId);
  if (!process) {
    return (
      <div className="p-3">
        <p className="text-muted">Process not found.</p>
      </div>
    );
  }

  const versionObj = process.versions?.find(v => v.version === activeProcess.version);
  const environment = environments.find(e => e.id === process.environment_id);
  const config = {
    id: process.id,
    name: process.name,
    version: activeProcess.version,
    environment: { id: process.environment_id, name: environment?.name },
    type: process.type,
    parameters: versionObj?.parameters,
    resource_requests: versionObj?.resource_requests,
    deadline_seconds: versionObj?.deadline_seconds,
  };

  const yamlText = Object.keys(config).map(k => {
    const v = toYaml(config[k], 1);
    return v.startsWith('\n') ? `${k}:${v}` : `${k}: ${v}`;
  }).join('\n');

  return (
    <div className="p-3 h-100 overflow-auto">
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {renderYamlWithLinks(yamlText)}
      </pre>
    </div>
  );
}

ProcessInfo.title = "Process info";
