import React, { useState } from 'react';
import { Button, Form } from 'react-bootstrap';

const KUBECONFIG_COMMAND =
  `kubectl config view --raw --minify --flatten | sed -E "s#(server: https://)[^:]+:8443#\\1$(hostname -I | awk '{print $1}'):$(docker port minikube 8443 | head -1 | cut -d: -f2)#"`;

export default function KubeconfigClusterForm({ value, onChange }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(KUBECONFIG_COMMAND).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Form.Group>
      <Form.Label>Kubeconfig (YAML or JSON)</Form.Label>
      <div className="d-flex align-items-center gap-2 mb-2">
        <code
          className="flex-grow-1 px-2 py-1 rounded"
          style={{ background: '#f6f8fa', fontSize: 13, wordBreak: 'break-all' }}
        >
          {KUBECONFIG_COMMAND}
        </code>
        <Button
          size="sm"
          variant="outline-secondary"
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy'}
          aria-label={copied ? 'Copied!' : 'Copy'}
        >
          <i className={`fa ${copied ? 'fa-check' : 'fa-copy'}`}></i>
        </Button>
      </div>
      <Form.Control
        as="textarea"
        rows={8}
        placeholder={'apiVersion: v1\nclusters:\n...'}
        value={value.kubeconfig || ''}
        onChange={e => onChange({ kubeconfig: e.target.value })}
      />
    </Form.Group>
  );
}
