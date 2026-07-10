import React from 'react';
import { Card, Form } from 'react-bootstrap';

export default function KubeconfigClusterForm({ value, onChange }) {
  return (
    <>
      <Card className="mb-3 bg-light">
        <Card.Body>
          <Card.Title as="h6">How do I get this?</Card.Title>
          <Card.Text as="div" className="text-muted small mb-0">
            Point your local <code>kubectl</code> at the cluster jobs should run on, then
            export the current context:
            <pre className="mb-0 mt-2">kubectl config view --raw --minify</pre>
            Paste the output below.
          </Card.Text>
        </Card.Body>
      </Card>
      <Form.Group>
        <Form.Label>Kubeconfig (YAML or JSON)</Form.Label>
        <Form.Control
          as="textarea"
          rows={8}
          placeholder={'apiVersion: v1\nclusters:\n...'}
          value={value.kubeconfig || ''}
          onChange={e => onChange({ kubeconfig: e.target.value })}
        />
      </Form.Group>
    </>
  );
}
