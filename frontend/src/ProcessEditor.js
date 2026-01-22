import validator from "@rjsf/validator-ajv8";
import React, { useEffect, useState, useContext } from "react";
import { CustomForm } from './jsoneditor';
import { ProcessContext } from './ProcessContext';
import { useProcessTypes, useCreateProcess } from "./hooks/useQueries";
import { getProcessVersion, getLatestVersion } from './api';

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
  const { data: types = {}, isLoading } = useProcessTypes();
  const { processes, setActiveProcess, refetchProcesses } = useContext(ProcessContext);
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

  const schema = selectedType ? types[selectedType]?.schema : null;

  return (
    <>
      <h3>New process – Parameters</h3>
      <div className="mb-3">
        <label className="form-label">Process Type: </label>
        <select
          className="form-select"
          value={selectedType || ""}
          onChange={e => setSelectedType(e.target.value)}
          disabled={isLoading}
        >
          <option value="">{isLoading ? "Loading..." : "Select type..."}</option>
          {Object.keys(types).map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {selectedType && (
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
      )}

      {schema && (
        <CustomForm
          schema={schema}
          formData={{}}
          validator={validator}
          onSubmit={({ formData }) => {
            console.log("Form submitted with data:", formData);
            createProcessMutation.mutate({
              name: processName,
              type: selectedType,
              params: formData,
              inputs: [],
              outputs: []
            }, {
              onSuccess: (newProcess) => {
                refetchProcesses();
                // Set active to the newly created process (version 1)
                setActiveProcess({ processId: newProcess.id, version: 1 });
                alert("Process created");
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
    processes, activeProcess, setActiveProcess, refetchProcesses
  } =  useContext(ProcessContext);
  const { data: types = {} } = useProcessTypes();
  const createProcessMutation = useCreateProcess();

  if (!activeProcess) return null;

  const process = processes.find(p => p.id === activeProcess.processId);
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
            id: process.id,
            name: process.name,
            type: process.type,
            params: formData
          }, {
            onSuccess: (updatedProcess) => {
              refetchProcesses();
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
