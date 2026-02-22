import validator from "@rjsf/validator-ajv8";
import React, { useEffect, useState, useContext } from "react";
import { Modal, Button, Card } from 'react-bootstrap';
import { CustomForm } from '../jsoneditor';
import { ProcessContext } from '../ProcessContext';
import { useEnvironmentProcessTypes, useCreateProcess } from "../datamodel/useQueries";
import { getProcessVersion, getLatestVersion } from '../datamodel/api';

export default function ProcessEditor({ }) {
  const {
    processes, setProcesses, activeProcess, setActiveProcess
  } =  useContext(ProcessContext);
  if (activeProcess) {
    return <ExistingProcessEditor />;
  } else {
    return <NewProcessEditor />;
  }
}

function NewProcessEditor({}) {
  const [selectedType, setSelectedType] = useState(null);
  const [processName, setProcessName] = useState("");
  const [cpuCores, setCpuCores] = useState(1);
  const [memoryGb, setMemoryGb] = useState(2);
  const [deadlineMinutes, setDeadlineMinutes] = useState(60);
  const [showResourceModal, setShowResourceModal] = useState(false);
  const [formData, setFormData] = useState({});
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

  // Generate unique default name when type changes
  useEffect(() => {
    if (selectedType) {
      // Count existing processes of this type
      const sameTypeCount = processes.filter(p => p.type === selectedType).length;
      const defaultName = `${selectedType}-${sameTypeCount + 1}`;
      setProcessName(defaultName);
    }
  }, [selectedType, processes]);

  // Reset selected type when environment changes
  useEffect(() => {
    setSelectedType(null);
  }, [selectedEnvironment]);

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

  // Reset form data when type changes
  useEffect(() => {
    setFormData({});
  }, [selectedType]);

  return (
    <>
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
              max="8"
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
              max="32"
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
                // Set active to the newly created process (version 1)
                setActiveProcess({ processId: newProcess.id, version: 1 });

              },
              onError: (error) => {
                console.error("Failed to create process:", error);
                alert("Failed to create process");
              }
            });
          }}
        />
      )}
    </>
  );
}

function ExistingProcessEditor({ }) {
  const {
    processes, activeProcess, setActiveProcess, invalidateProject, currentProject
  } =  useContext(ProcessContext);
  const createProcessMutation = useCreateProcess();

  // Find process before hooks
  const process = activeProcess ? processes.find(p => p.id === activeProcess.processId) : null;

  // Call hooks unconditionally at top level
  const { data: types = {} } = useEnvironmentProcessTypes(process?.environment_id);

  // Now we can do conditional returns
  if (!activeProcess) return null;
  if (!process) return null;

  const versionObj = getProcessVersion(process, activeProcess.version);
  const schema = types[process.type]?.schema;

  if (!schema || !versionObj) return null;

  return (
    <div>
      <h3>{process.name} – Parameters (v{activeProcess.version})</h3>
      <div className="mb-3">Process type: {process.type}</div>
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
              type: process.type,
              environment_id: process.environment_id,
              params: formData
            },
            projectId: currentProject
          }, {
            onSuccess: async (updatedProcess) => {
              await invalidateProject();
              // Set active to the new latest version
              const newVersion = getLatestVersion(updatedProcess);
              setActiveProcess({ processId: process.id, version: newVersion });
              alert("New version created");
            },
            onError: (error) => {
              console.error("Failed to create new version:", error);
              alert("Failed to create new version");
            }
          });
        }}
      />
    </div>
  );
}

ProcessEditor.title = "Process editor";
