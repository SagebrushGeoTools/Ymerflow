import React, { useEffect, useState } from 'react';
import { Alert, Button, Spinner } from 'react-bootstrap';
import { ABSOLUTE_API } from '../datamodel/api';
import { useAdminClusterByRegistrationToken } from '../datamodel/useAuthQueries';

// See docs/plans/minikube-cluster-registration-ux.md. Unlike KubeconfigClusterForm, this type
// never asks the admin to paste a kubeconfig back — `value`/`onChange` (provider_config) go
// completely unused here; the backend fills provider_config in later via the registration
// callback. On a fresh (non-edit) selection, a registration token is generated client-side the
// moment this component mounts and the setup command is shown immediately, with no backend round
// trip. `onDiscovered` (ClusterFormModal-only prop, other provider forms ignore it) is called once
// polling finds the Cluster row the callback created for that token.
export default function MinikubeClusterForm({ isEdit, existingCluster, onDiscovered }) {
  const [copied, setCopied] = useState(false);
  const [token] = useState(() => crypto.randomUUID());

  const { data: discovered } = useAdminClusterByRegistrationToken(!isEdit ? token : null);

  useEffect(() => {
    if (discovered) onDiscovered(discovered);
  }, [discovered, onDiscovered]);

  if (isEdit) {
    const status = existingCluster?.provisioning_status;
    if (status === 'pending') {
      return (
        <p className="text-muted">
          The setup script's configuration was received, but this cluster hasn't been activated
          yet. Check "Active" below and click Save to activate it.
        </p>
      );
    }
    if (status === 'failed') {
      return (
        <p className="text-danger">
          The connection test after the setup script's callback failed. Re-run the setup command
          on the target host (safe to re-paste) to retry, then edit this cluster again.
        </p>
      );
    }
    return (
      <p className="text-muted">
        Connected — no further action needed. This cluster's kubeconfig was captured by its
        one-time setup script and isn't editable here.
      </p>
    );
  }

  const command = `curl -fsSL ${ABSOLUTE_API}/static/assets/setup-minikube-remote.sh | REGISTER_TOKEN=${token} bash`;

  const handleCopy = () => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div>
      <Alert variant="info" className="py-2">
        Run this command in an SSH shell on the target host (Docker + sudo already installed
        there) to provision and register this cluster. It installs minikube if needed, trusts the
        registry, provisions Kueue/RBAC, and registers the cluster back here automatically.
      </Alert>
      <div className="d-flex align-items-center gap-2 mb-2">
        <code
          className="flex-grow-1 px-2 py-1 rounded"
          style={{ background: '#f6f8fa', fontSize: 13, wordBreak: 'break-all' }}
        >
          {command}
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
      {discovered ? (
        <p className="text-success small mb-0">
          ✓ Configuration received. Fill in the fields below and click Save to activate.
        </p>
      ) : (
        <p className="text-muted small mb-0 d-flex align-items-center gap-2">
          <Spinner size="sm" animation="border" /> Waiting for the setup command to be run...
        </p>
      )}
    </div>
  );
}
