import validator from "@rjsf/validator-ajv8";
import React, { useEffect, useState, useContext } from "react";
import Form from "@rjsf/core";
import { ProcessContext } from './ProcessContext';
import { getProcessTypes, createProcess } from "./api";

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
  const [types, setTypes] = useState({});
  const [selectedType, setSelectedType] = useState(null);

  useEffect(() => {
    getProcessTypes().then(setTypes);
  }, []);

  const schema = selectedType ? types[selectedType].schema : null;

  return (
    <>
      <h3>New process – Parameters</h3>
      <div className="mb-3">
        <label className="form-label">Process Type: </label>
        <select
          className="form-select"
          value={selectedType || ""}
          onChange={e => setSelectedType(e.target.value)}
        >
          <option value="">Select type...</option>
          {Object.keys(types).map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {schema && (
        <Form
          schema={schema}
          validator={validator}
          onSubmit={({ formData }) => {
            createProcess({
              name: `${selectedType}-process`,
              type: selectedType,
              params: formData,
              inputs: [],
              outputs: []
            }).then(p => {
              alert("Process created");
            });
          }}
        />
      )}
    </>
  );
}

function ExistingProcessEditor({ }) {
  const {
    processes, setProcesses, activeProcess, setActiveProcess
  } =  useContext(ProcessContext);
  const [schema, setSchema] = useState(null);

  useEffect(() => {
    if (activeProcess) {
      getProcessTypes().then(types => {
        setSchema(types[activeProcess.type].schema);
      });
    } else {
      setSchema(null);
    }
  }, [activeProcess]);

  if (!schema || !activeProcess) return null;

  return (
    <div>
      <h3>{activeProcess.name} – Parameters</h3>
      <div className="mb-3">Process type: {activeProcess.type}</div>
      <Form
        schema={schema}
        validator={validator}
      />
    </div>
  );
}

ProcessEditor.title = "Process editor";
