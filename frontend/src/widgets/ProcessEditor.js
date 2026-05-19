import validator from "@rjsf/validator-ajv8";
import React, { useEffect, useState, useContext, useRef } from "react";
import { Modal, Button, Card } from 'react-bootstrap';
import { CustomForm } from '../jsoneditor';
import { ProcessContext } from '../ProcessContext';
import { useEnvironmentProcessTypes, useCreateProcess, useResourceLimits } from "../datamodel/useQueries";
import { getProcessVersion, getLatestVersion } from '../datamodel/api';
import { LayoutContext } from '../flexout/LayoutContext';

function useActivateProcessLog() {
  const { findWidgetPaths, activatePath } = useContext(LayoutContext);
  return () => {
    const paths = findWidgetPaths('ProcessLog');
    if (paths.length > 0) activatePath(paths[0]);
  };
}

export default function ProcessEditor({ }) {
  const {
    processes, setProcesses, activeProcess, setActiveProcess
  } =  useContext(ProcessContext);
  const [templateState, setTemplateState] = useState(null);
  if (activeProcess) {
    return <ExistingProcessEditor setTemplateState={setTemplateState} />;
  } else {
    return <NewProcessEditor templateState={templateState} onTemplateConsumed={() => setTemplateState(null)} />;
  }
}

function NewProcessEditor({ templateState, onTemplateConsumed }) {
  const [selectedType, setSelectedType] = useState(null);
  const [processName, setProcessName] = useState("");
  const [cpuCores, setCpuCores] = useState(1);
  const [memoryGb, setMemoryGb] = useState(2);
  const [deadlineMinutes, setDeadlineMinutes] = useState(60);
  const [showResourceModal, setShowResourceModal] = useState(false);
  const [formData, setFormData] = useState({});
  const activateProcessLog = useActivateProcessLog();
  const {
    processes,
    setActiveProcess,
    invalidateProject,
    selectedEnvironment,
    setSelectedEnvironment,
    environments,
    environmentsLoading,
    currentProject
  } = useContext(ProcessContext);
  const { data: types = {}, isLoading: typesLoading } = useEnvironmentProcessTypes(selectedEnvironment);
  const createProcessMutation = useCreateProcess();
  const { data: resourceLimits } = useResourceLimits();
  const maxCpu = resourceLimits?.max_cpu_cores ?? 8;
  const maxMemory = resourceLimits?.max_memory_gb ?? 32;

  // Refs to skip reset-effects when applying a template
  const skipTypeResetRef = useRef(false);
  const skipFormDataResetRef = useRef(false);

  // Generate unique default name when type changes
  useEffect(() => {
    if (selectedType) {
      // Count existing processes of this type
      const sameTypeCount = processes.filter(p => p.type === selectedType).length;
      const defaultName = `${selectedType}-${sameTypeCount + 1}`;
      setProcessName(defaultName);
    }
  }, [selectedType, processes]);

  // Reset selected type when environment changes (skipped during template init)
  useEffect(() => {
    if (skipTypeResetRef.current) {
      skipTypeResetRef.current = false;
      return;
    }
    setSelectedType(null);
  }, [selectedEnvironment]);

  // Initialize from template once on mount (after other effects have run)
  useEffect(() => {
    if (!templateState) return;
    skipTypeResetRef.current = true;
    skipFormDataResetRef.current = 2;  // fires on mount AND when selectedType changes
    setSelectedEnvironment(templateState.environment);
    setSelectedType(templateState.type);
    setFormData(templateState.formData || {});
    if (onTemplateConsumed) onTemplateConsumed();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Calculate estimated costs
  const estimatedCostPerMinute = (cpuCores * 60 * 0.0001) + (memoryGb * 60 * 0.00002);
  const estimatedMaxCost = estimatedCostPerMinute * deadlineMinutes;

  const schema = selectedType ? types[selectedType]?.schema : null;

  // Clean undefined properties from form data (fixes anyOf validation issue)
  const cleanFormData = (data) => {
    if (!data) return data;

    const clean = (obj) => {
      if (Array.isArray(obj)) {
        return obj.map(clean);
      } else if (obj && typeof obj === 'object') {
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
          if (value !== undefined && value !== null) {
            cleaned[key] = clean(value);
          }
        }
        return cleaned;
      }
      return obj;
    };

    return clean(data);
  };

  // Handle form data changes with cleaning
  const handleFormChange = (e) => {
    const cleaned = cleanFormData(e.formData);
    setFormData(cleaned);
  };

  // Reset form data when type changes (skipped during template init)
  useEffect(() => {
    if (skipFormDataResetRef.current > 0) {
      skipFormDataResetRef.current--;
      return;
    }
    setFormData({});
  }, [selectedType]);

  return (
    <div className="container-fluid">
      <div className="row">
        {/* Left Column - Parameters */}
        <div className="col-md-6">
          <h3>New process – Parameters</h3>

          <div className="mb-3">
            <label className="form-label">Process Name: </label>
            <input
              type="text"
              className="form-control"
              value={processName}
              onChange={e => setProcessName(e.target.value)}
              required
              placeholder="Enter process name"
            />
          </div>

          <div className="mb-3">
            <label className="form-label">Environment: </label>
            <select
              className="form-select"
              value={selectedEnvironment || ""}
              onChange={e => setSelectedEnvironment(e.target.value)}
              disabled={environmentsLoading}
            >
              <option value="">{environmentsLoading ? "Loading..." : "Select environment..."}</option>
              {environments.map(env => (
                <option key={env.id} value={env.id}>{env.name}</option>
              ))}
            </select>
          </div>

          {selectedEnvironment && (
            <div className="mb-3">
              <label className="form-label">Process Type: </label>
              <select
                className="form-select"
                value={selectedType || ""}
                onChange={e => setSelectedType(e.target.value)}
                disabled={typesLoading}
              >
                <option value="">{typesLoading ? "Loading..." : "Select type..."}</option>
                {Object.keys(types).map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Right Column - Resource Configuration Card */}
        <div className="col-md-6">
          <h3 className="d-flex justify-content-between align-items-center">
            Resource Configuration
            <Button
              variant="link"
              size="sm"
              onClick={() => setShowResourceModal(true)}
              className="p-0"
              title="Edit resources"
            >
              <i className="fa fa-edit"></i>
            </Button>
          </h3>
          <Card>
            <Card.Body>
              <div className="mb-2">
                <strong>CPU:</strong> {cpuCores} cores
              </div>
              <div className="mb-2">
                <strong>Memory:</strong> {memoryGb} GB
              </div>
              <div className="mb-2">
                <strong>Deadline:</strong> {deadlineMinutes} minutes
              </div>
            </Card.Body>
            <Card.Footer className="text-muted">
              <strong>Estimated max cost:</strong> ${estimatedMaxCost.toFixed(4)} (${estimatedCostPerMinute.toFixed(4)} per minute)
              <br />
              <small>(Actual cost based on runtime)</small>
            </Card.Footer>
          </Card>
        </div>
      </div>

      {/* Resource Configuration Modal */}
      <Modal show={showResourceModal} onHide={() => setShowResourceModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Edit Resource Configuration</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="mb-3">
            <label className="form-label">CPU (cores): {cpuCores}</label>
            <input
              type="range"
              className="form-range"
              min="0.1"
              max={maxCpu}
              step="0.1"
              value={cpuCores}
              onChange={e => setCpuCores(parseFloat(e.target.value))}
            />
          </div>

          <div className="mb-3">
            <label className="form-label">Memory (GB): {memoryGb}</label>
            <input
              type="range"
              className="form-range"
              min="0.5"
              max={maxMemory}
              step="0.5"
              value={memoryGb}
              onChange={e => setMemoryGb(parseFloat(e.target.value))}
            />
          </div>

          <div className="mb-3">
            <label className="form-label">Deadline (minutes)</label>
            <input
              type="number"
              className="form-control"
              min="1"
              max="1440"
              value={deadlineMinutes}
              onChange={e => setDeadlineMinutes(parseInt(e.target.value) || 60)}
            />
          </div>

          <div className="alert alert-info">
            <strong>Estimated max cost:</strong> ${estimatedMaxCost.toFixed(4)} (${estimatedCostPerMinute.toFixed(4)} per minute)
            <br />
            <small>(Actual cost based on runtime will be charged on completion)</small>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowResourceModal(false)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>

      {schema && (
        <CustomForm
          schema={schema}
          formData={formData}
          validator={validator}
          onChange={handleFormChange}
          onSubmit={({ formData: submittedData }) => {
            const cleanedData = cleanFormData(submittedData);
            console.log("Form submitted with data:", cleanedData);
            createProcessMutation.mutate({
              proc: {
                name: processName,
                type: selectedType,
                environment_id: selectedEnvironment,
                params: cleanedData,
                resource_requests: {
                  cpu: `${Math.floor(cpuCores * 1000)}m`,
                  memory: `${memoryGb}Gi`,
                  "ephemeral-storage": "10Gi"
                },
                deadline_seconds: deadlineMinutes * 60,
                inputs: [],
                outputs: []
              },
              projectId: currentProject
            }, {
              onSuccess: async (newProcess) => {
                await invalidateProject();
                setActiveProcess({ processId: newProcess.id, version: 1 });
                activateProcessLog();
              },
              onError: (error) => {
                console.error("Failed to create process:", error);
                alert("Failed to create process");
              }
            });
          }}
        />
      )}
    </div>
  );
}

function ExistingProcessEditor({ setTemplateState }) {
  const {
    processes, activeProcess, setActiveProcess, invalidateProject, currentProject,
    environments, environmentsLoading
  } =  useContext(ProcessContext);
  const createProcessMutation = useCreateProcess();
  const activateProcessLog = useActivateProcessLog();

  // Find process before hooks
  const process = activeProcess ? processes.find(p => p.id === activeProcess.processId) : null;
  const versionObj = process && activeProcess ? getProcessVersion(process, activeProcess.version) : null;

  // Local state for environment/type (allows changing for new version)
  const [localEnvironment, setLocalEnvironment] = useState(process?.environment_id ?? null);
  const [localType, setLocalType] = useState(process?.type ?? null);

  // Resource configuration state (defaults; synced from loaded version below)
  const [cpuCores, setCpuCores] = useState(1);
  const [memoryGb, setMemoryGb] = useState(2);
  const [deadlineMinutes, setDeadlineMinutes] = useState(60);
  const [showResourceModal, setShowResourceModal] = useState(false);

  // Sync when active process changes
  useEffect(() => {
    if (process) {
      setLocalEnvironment(process.environment_id);
      setLocalType(process.type);
    }
  }, [process?.id]);

  // Sync resource config from current version when process/version changes
  useEffect(() => {
    if (versionObj?.resource_requests) {
      setCpuCores(parseInt(versionObj.resource_requests.cpu ?? "1000m") / 1000);
      setMemoryGb(parseFloat(versionObj.resource_requests.memory ?? "2Gi"));
    }
    if (versionObj?.deadline_seconds != null) {
      setDeadlineMinutes(versionObj.deadline_seconds / 60);
    }
  }, [activeProcess?.processId, activeProcess?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Call hooks unconditionally at top level
  const { data: types = {}, isLoading: typesLoading } = useEnvironmentProcessTypes(localEnvironment);
  const { data: resourceLimits } = useResourceLimits();
  const maxCpu = resourceLimits?.max_cpu_cores ?? 8;
  const maxMemory = resourceLimits?.max_memory_gb ?? 32;

  // Reset type if it's not available in the newly selected environment
  useEffect(() => {
    if (!typesLoading && localType && Object.keys(types).length > 0 && !types[localType]) {
      setLocalType(null);
    }
  }, [localEnvironment, types, typesLoading]);

  // Now we can do conditional returns
  if (!activeProcess) return null;
  if (!process) return null;
  if (!versionObj) return null;

  const schema = localType ? types[localType]?.schema : null;
  const estimatedCostPerMinute = (cpuCores * 60 * 0.0001) + (memoryGb * 60 * 0.00002);
  const estimatedMaxCost = estimatedCostPerMinute * deadlineMinutes;

  return (
    <div className="container-fluid">
      <div className="row">
        <div className="col-md-6">
          <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
            <h3 className="mb-0">{process.name} – Parameters (v{activeProcess.version})</h3>
            <Button
              variant="outline-primary"
              size="sm"
              onClick={() => {
                setTemplateState({
                  environment: localEnvironment,
                  type: localType,
                  formData: versionObj.parameters || {}
                });
                setActiveProcess(null);
              }}
            >
              Create new
            </Button>
          </div>
          <div className="mb-3">
            <label className="form-label">Environment: </label>
            <select
              className="form-select"
              value={localEnvironment || ""}
              onChange={e => setLocalEnvironment(e.target.value)}
              disabled={environmentsLoading}
            >
              <option value="">{environmentsLoading ? "Loading..." : "Select environment..."}</option>
              {environments.map(env => (
                <option key={env.id} value={env.id}>{env.name}</option>
              ))}
            </select>
          </div>

          {localEnvironment && (
            <div className="mb-3">
              <label className="form-label">Process Type: </label>
              <select
                className="form-select"
                value={localType || ""}
                onChange={e => setLocalType(e.target.value)}
                disabled={typesLoading}
              >
                <option value="">{typesLoading ? "Loading..." : "Select type..."}</option>
                {Object.keys(types).map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="col-md-6">
          <h3 className="d-flex justify-content-between align-items-center">
            Resource Configuration
            <Button
              variant="link"
              size="sm"
              onClick={() => setShowResourceModal(true)}
              className="p-0"
              title="Edit resources"
            >
              <i className="fa fa-edit"></i>
            </Button>
          </h3>
          <Card>
            <Card.Body>
              <div className="mb-2">
                <strong>CPU:</strong> {cpuCores} cores
              </div>
              <div className="mb-2">
                <strong>Memory:</strong> {memoryGb} GB
              </div>
              <div className="mb-2">
                <strong>Deadline:</strong> {deadlineMinutes} minutes
              </div>
            </Card.Body>
            <Card.Footer className="text-muted">
              <strong>Estimated max cost:</strong> ${estimatedMaxCost.toFixed(4)} (${estimatedCostPerMinute.toFixed(4)} per minute)
              <br />
              <small>(Actual cost based on runtime)</small>
            </Card.Footer>
          </Card>
        </div>
      </div>

      <Modal show={showResourceModal} onHide={() => setShowResourceModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Edit Resource Configuration</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="mb-3">
            <label className="form-label">CPU (cores): {cpuCores}</label>
            <input
              type="range"
              className="form-range"
              min="0.1"
              max={maxCpu}
              step="0.1"
              value={cpuCores}
              onChange={e => setCpuCores(parseFloat(e.target.value))}
            />
          </div>
          <div className="mb-3">
            <label className="form-label">Memory (GB): {memoryGb}</label>
            <input
              type="range"
              className="form-range"
              min="0.5"
              max={maxMemory}
              step="0.5"
              value={memoryGb}
              onChange={e => setMemoryGb(parseFloat(e.target.value))}
            />
          </div>
          <div className="mb-3">
            <label className="form-label">Deadline (minutes)</label>
            <input
              type="number"
              className="form-control"
              min="1"
              max="1440"
              value={deadlineMinutes}
              onChange={e => setDeadlineMinutes(parseInt(e.target.value) || 60)}
            />
          </div>
          <div className="alert alert-info">
            <strong>Estimated max cost:</strong> ${estimatedMaxCost.toFixed(4)} (${estimatedCostPerMinute.toFixed(4)} per minute)
            <br />
            <small>(Actual cost based on runtime will be charged on completion)</small>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowResourceModal(false)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>

      {schema && (
        <CustomForm
          schema={schema}
          formData={versionObj.parameters || {}}
          validator={validator}
          onSubmit={({ formData }) => {
            console.log("Saving new version with data:", formData);
            createProcessMutation.mutate({
              proc: {
                id: process.id,
                name: process.name,
                type: localType,
                environment_id: localEnvironment,
                params: formData,
                resource_requests: {
                  cpu: `${Math.floor(cpuCores * 1000)}m`,
                  memory: `${memoryGb}Gi`,
                  "ephemeral-storage": "10Gi"
                },
                deadline_seconds: deadlineMinutes * 60,
              },
              projectId: currentProject
            }, {
              onSuccess: async (updatedProcess) => {
                await invalidateProject();
                const newVersion = getLatestVersion(updatedProcess);
                setActiveProcess({ processId: process.id, version: newVersion });
                activateProcessLog();
              },
              onError: (error) => {
                console.error("Failed to create new version:", error);
                alert("Failed to create new version");
              }
            });
          }}
        />
      )}
    </div>
  );
}

ProcessEditor.title = "Process editor";
