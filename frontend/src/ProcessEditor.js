import validator from "@rjsf/validator-ajv8";
import React, { useEffect, useState, useContext } from "react";
import { CustomForm } from './jsoneditor';
import { ProcessContext } from './ProcessContext';
import { useProcessTypes, useCreateProcess } from "./hooks/useQueries";

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
  const { data: types = {}, isLoading } = useProcessTypes();
  const createProcessMutation = useCreateProcess();

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

      {schema && (
        <CustomForm
          schema={schema}
          formData={{}}
          validator={validator}
          onSubmit={({ formData }) => {
            console.log("Form submitted with data:", formData);
            createProcessMutation.mutate({
              name: `${selectedType}-process`,
              type: selectedType,
              params: formData,
              inputs: [],
              outputs: []
            }, {
              onSuccess: () => {
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
    activeProcess
  } =  useContext(ProcessContext);
  const { data: types = {} } = useProcessTypes();

  const schema = activeProcess ? types[activeProcess.type]?.schema : null;

  if (!schema || !activeProcess) return null;

  return (
    <div>
      <h3>{activeProcess.name} – Parameters</h3>
      <div className="mb-3">Process type: {activeProcess.type}</div>
      <CustomForm
        schema={schema}
        formData={activeProcess.params || {}}
        validator={validator}
      />
    </div>
  );
}

ProcessEditor.title = "Process editor";
