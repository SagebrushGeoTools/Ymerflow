import React from 'react';
import { Form } from 'react-bootstrap';

export default function KubeconfigClusterForm({ value, onChange, hasExisting }) {
  return (
    <Form.Group>
      <Form.Label>Kubeconfig (YAML or JSON)</Form.Label>
      <Form.Control
        as="textarea"
        rows={8}
        placeholder={hasExisting ? '(currently set — paste to replace)' : 'apiVersion: v1\nclusters:\n...'}
        value={value.kubeconfig || ''}
        onChange={e => onChange({ kubeconfig: e.target.value })}
      />
    </Form.Group>
  );
}
