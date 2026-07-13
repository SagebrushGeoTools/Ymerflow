import React, { useState } from 'react';
import { Button, Alert } from 'react-bootstrap';

// See docs/plans/done/remote-cluster-provisioning-and-registry.md Phase 6. Unlike KubeconfigClusterForm,
// this type never asks the admin to paste a kubeconfig back — `value`/`onChange` (provider_config)
// go completely unused here; the backend fills provider_config in later via the registration
// callback. `registrationCommand` and `provisioningStatus` are extra props ClustersAdminPanel's
// ClusterFormModal passes ONLY to this component (other provider forms just ignore them).
export default function MinikubeClusterForm({ registrationCommand, provisioningStatus }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(registrationCommand).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (registrationCommand) {
    return (
      <div>
        <Alert variant="success" className="py-2">
          Cluster created. Run this command in an SSH shell on the target host (Docker + sudo
          already installed there) to finish setup:
        </Alert>
        <div className="d-flex align-items-center gap-2 mb-2">
          <code
            className="flex-grow-1 px-2 py-1 rounded"
            style={{ background: '#f6f8fa', fontSize: 13, wordBreak: 'break-all' }}
          >
            {registrationCommand}
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
        <p className="text-muted small mb-0">
          The command installs minikube if missing, sets up registry trust, provisions Kueue/RBAC,
          and registers the cluster back here automatically. Single-use and time-limited — you can
          close this dialog; the cluster row stays "pending" until the script's callback lands,
          then flips to "active" on its own.
        </p>
      </div>
    );
  }

  if (provisioningStatus === 'pending') {
    return (
      <p className="text-muted">
        Registration is still pending — waiting for the setup script's callback from the target
        host. If the one-time command was lost or its token expired, create a new cluster instead
        (this one will stay pending).
      </p>
    );
  }

  if (provisioningStatus === 'failed') {
    return (
      <p className="text-danger">
        Registration failed (token expired before the callback arrived, or the connection test
        after callback didn't pass). Create a new cluster to get a fresh setup command.
      </p>
    );
  }

  if (provisioningStatus === 'active') {
    return (
      <p className="text-muted">
        Connected — no further action needed. This cluster's kubeconfig was captured by its
        one-time setup script and isn't editable here.
      </p>
    );
  }

  return (
    <p className="text-muted">
      Click Save to create the cluster and generate a one-time setup command. Paste that command
      into an SSH shell on the target host (Docker + sudo already installed there) — it installs
      minikube if needed, trusts the registry, provisions Kueue/RBAC, and registers the cluster
      back here automatically. No kubeconfig to copy by hand.
    </p>
  );
}
