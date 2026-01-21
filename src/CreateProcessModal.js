import validator from "@rjsf/validator-ajv8";
import React, { useEffect, useState } from "react";
import Form from "@rjsf/core";
import { getProcessTypes, createProcess } from "./api";

export default function CreateProcessModal({ show, onClose, onCreated }) {
  const [types, setTypes] = useState({});
  const [selectedType, setSelectedType] = useState(null);

  useEffect(() => {
    if (show) {
      getProcessTypes().then(setTypes);
    }
  }, [show]);

  if (!show) return null;

  const schema = selectedType ? types[selectedType].schema : null;

  return (
    <div className="modal d-block" tabIndex="-1">
      <div className="modal-dialog modal-lg">
        <div className="modal-content">

          <div className="modal-header">
            <h5 className="modal-title">Create New Process</h5>
            <button className="btn-close" onClick={onClose} />
          </div>

          <div className="modal-body">
            <div className="mb-3">
              <label className="form-label">Process Type</label>
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
                    onCreated(p);
                    onClose();
                  });
                }}
              />
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
