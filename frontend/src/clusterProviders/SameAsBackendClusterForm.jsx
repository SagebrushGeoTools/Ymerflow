import React from 'react';

export default function SameAsBackendClusterForm({ value, onChange }) {
  return (
    <p className="text-muted">
      No configuration needed — jobs run on the same cluster the backend itself is running in
      (or, in local dev, whatever cluster your local kubeconfig points to).
    </p>
  );
}
