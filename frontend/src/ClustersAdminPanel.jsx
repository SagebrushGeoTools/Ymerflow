import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Badge, Modal, Form, Alert, Spinner } from 'react-bootstrap';
import { hooks } from './plugins/hooks';
import {
  useAdminClusters,
  useCreateAdminCluster,
  useUpdateAdminCluster,
  useTestAdminClusterConnection,
} from './datamodel/useAuthQueries';

const EMPTY_FORM = {
  name: '',
  namespace: 'nagelfluh-jobs',
  registryUrl: '',
  registryAuth: '',
  sortOrder: 0,
  maxRuntimeMinutes: '',
  unbounded: true,
  active: true,
};

function ClusterFormModal({ show, onHide, cluster }) {
  const providerForms = hooks.run.cluster_provider_forms();
  const createMutation = useCreateAdminCluster();
  const updateMutation = useUpdateAdminCluster();
  const testMutation = useTestAdminClusterConnection();

  const [form, setForm] = useState(EMPTY_FORM);
  const [clusterType, setClusterType] = useState(providerForms[0]?.type ?? '');
  const [providerConfig, setProviderConfig] = useState({});
  const [configTouched, setConfigTouched] = useState(false);
  const [error, setError] = useState(null);
  const [testResult, setTestResult] = useState(null);

  const isEdit = !!cluster;

  // Reset all form state on every open, so state from a previous edit/create never leaks in —
  // connection config is always write-only (see docs/plans/cluster-admin-ui.md Design decisions).
  useEffect(() => {
    if (!show) return;
    if (cluster) {
      setForm({
        name: cluster.name,
        namespace: cluster.namespace,
        registryUrl: cluster.registry_url || '',
        registryAuth: '',
        sortOrder: cluster.sort_order,
        maxRuntimeMinutes: cluster.max_runtime_seconds != null ? String(cluster.max_runtime_seconds / 60) : '',
        unbounded: cluster.max_runtime_seconds == null,
        active: cluster.active,
      });
      setClusterType(cluster.cluster_type);
    } else {
      setForm(EMPTY_FORM);
      setClusterType(providerForms[0]?.type ?? '');
    }
    setProviderConfig({});
    setConfigTouched(false);
    setError(null);
    setTestResult(null);
  }, [show, cluster]);

  const activeProviderForm = providerForms.find(p => p.type === clusterType);
  const hasProviderConfig = isEdit && cluster.cluster_type === clusterType && cluster.has_provider_config;

  const handleTypeChange = (type) => {
    setClusterType(type);
    setProviderConfig({});
    setConfigTouched(true);
    setTestResult(null);
  };

  const handleConfigChange = (patch) => {
    setProviderConfig(prev => ({ ...prev, ...patch }));
    setConfigTouched(true);
    setTestResult(null);
  };

  const handleTest = async () => {
    setError(null);
    setTestResult(null);
    try {
      await testMutation.mutateAsync({ cluster_type: clusterType, provider_config: providerConfig });
      setTestResult({ ok: true });
    } catch (e) {
      setTestResult({ ok: false, message: e?.response?.data?.detail || 'Connection test failed' });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const body = {
      name: form.name,
      namespace: form.namespace,
      registry_url: form.registryUrl || null,
      sort_order: parseInt(form.sortOrder, 10) || 0,
      max_runtime_seconds: form.unbounded ? null : Math.round(parseFloat(form.maxRuntimeMinutes) * 60),
    };
    if (form.registryAuth) body.registry_auth = form.registryAuth;
    if (isEdit) body.active = form.active;
    if (configTouched) {
      body.cluster_type = clusterType;
      body.provider_config = providerConfig;
    }

    try {
      if (isEdit) {
        await updateMutation.mutateAsync({ clusterId: cluster.id, body });
      } else {
        await createMutation.mutateAsync(body);
      }
      onHide();
    } catch (e) {
      setError(e?.response?.data?.detail || 'Save failed');
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <Modal show={show} onHide={onHide}>
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton>
          <Modal.Title>{isEdit ? 'Edit Cluster' : 'Add Cluster'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {error && <Alert variant="danger">{error}</Alert>}

          <Form.Group className="mb-3">
            <Form.Label>Name</Form.Label>
            <Form.Control required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Namespace</Form.Label>
            <Form.Control value={form.namespace} onChange={e => setForm(f => ({ ...f, namespace: e.target.value }))} />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Registry URL</Form.Label>
            <Form.Control value={form.registryUrl} onChange={e => setForm(f => ({ ...f, registryUrl: e.target.value }))} />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Registry Auth</Form.Label>
            <Form.Control
              type="password"
              placeholder={cluster?.has_registry_auth ? '(currently set — enter to replace)' : ''}
              value={form.registryAuth}
              onChange={e => setForm(f => ({ ...f, registryAuth: e.target.value }))}
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Sort Order</Form.Label>
            <Form.Control type="number" value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: e.target.value }))} />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Check
              type="checkbox"
              label="Unbounded max runtime"
              checked={form.unbounded}
              onChange={e => setForm(f => ({ ...f, unbounded: e.target.checked }))}
            />
            {!form.unbounded && (
              <Form.Control
                type="number" min="1" required className="mt-2"
                placeholder="Max runtime (minutes)"
                value={form.maxRuntimeMinutes}
                onChange={e => setForm(f => ({ ...f, maxRuntimeMinutes: e.target.value }))}
              />
            )}
          </Form.Group>
          {isEdit && (
            <Form.Group className="mb-3">
              <Form.Check
                type="checkbox"
                label="Active"
                checked={form.active}
                onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
              />
            </Form.Group>
          )}

          <hr />

          <Form.Group className="mb-3">
            <Form.Label>Cluster Type</Form.Label>
            <Form.Select value={clusterType} onChange={e => handleTypeChange(e.target.value)}>
              {providerForms.map(p => <option key={p.type} value={p.type}>{p.title}</option>)}
            </Form.Select>
          </Form.Group>
          {activeProviderForm && (
            <activeProviderForm.Component
              value={providerConfig}
              onChange={handleConfigChange}
              hasExisting={hasProviderConfig}
            />
          )}
          <div className="d-flex align-items-center gap-2">
            <Button variant="outline-secondary" size="sm" onClick={handleTest} disabled={testMutation.isPending}>
              {testMutation.isPending ? <Spinner size="sm" animation="border" /> : 'Test Connection'}
            </Button>
            {testResult?.ok && <span className="text-success">Connection OK</span>}
            {testResult && !testResult.ok && <span className="text-danger">{testResult.message}</span>}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

export default function ClustersAdminPanel() {
  const { data: clusters = [], isLoading } = useAdminClusters();
  const [showModal, setShowModal] = useState(false);
  const [editingCluster, setEditingCluster] = useState(null);

  const openCreate = () => { setEditingCluster(null); setShowModal(true); };
  const openEdit = (cluster) => { setEditingCluster(cluster); setShowModal(true); };

  if (isLoading) return <p className="text-muted">Loading...</p>;

  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <Card.Title className="mb-0">Cluster Administration</Card.Title>
          <Button size="sm" onClick={openCreate}>Add Cluster</Button>
        </div>
        <Table size="sm" hover>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Namespace</th>
              <th>Registry URL</th>
              <th>Sort Order</th>
              <th>Max Runtime</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {clusters.map(c => (
              <tr key={c.id} className={c.active ? '' : 'text-muted'}>
                <td>{c.name}</td>
                <td>{c.cluster_type}</td>
                <td>{c.namespace}</td>
                <td>{c.registry_url || <span className="text-muted">—</span>}</td>
                <td>{c.sort_order}</td>
                <td>{c.max_runtime_seconds != null ? `${Math.round(c.max_runtime_seconds / 60)} min` : 'unbounded'}</td>
                <td>{c.active ? <Badge bg="success">Active</Badge> : <Badge bg="secondary">Retired</Badge>}</td>
                <td>
                  <Button size="sm" variant="outline-primary" onClick={() => openEdit(c)}>Edit</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card.Body>
      <ClusterFormModal show={showModal} onHide={() => setShowModal(false)} cluster={editingCluster} />
    </Card>
  );
}
