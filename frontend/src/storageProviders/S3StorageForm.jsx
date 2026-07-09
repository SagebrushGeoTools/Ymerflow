import React from 'react';
import { Form } from 'react-bootstrap';

export default function S3StorageForm({ value, onChange }) {
  return (
    <>
      <p className="text-muted">
        AWS S3 support is not implemented yet — provisioning and Test Connection will fail for
        this protocol. Any values entered here are preserved for whenever real support lands.
      </p>
      <Form.Group className="mb-3">
        <Form.Label>Connection config (JSON)</Form.Label>
        <Form.Control
          as="textarea"
          rows={4}
          placeholder="{}"
          value={value.raw || ''}
          onChange={e => onChange({ ...value, raw: e.target.value })}
        />
      </Form.Group>
    </>
  );
}
