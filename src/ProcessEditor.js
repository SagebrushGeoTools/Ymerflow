import validator from "@rjsf/validator-ajv8";
import React, { useEffect, useState, useContext } from "react";
import Form from "@rjsf/core";
import { getProcessTypes } from "./api";
import { ProcessContext } from './ProcessContext';

export default function ProcessEditor({ }) {
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

  if (!schema) return null;

  return (
    <div>
      <h3>{activeProcess.name} – Parameters</h3>
      <div>Type: {activeProcess.type}</div>
      <Form
        schema={schema}
        validator={validator}
      />
    </div>
  );
}
