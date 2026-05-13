import React, { useContext, useEffect, useState } from 'react';
import { Container, Card, Table, Button, Form, Modal, Alert, Badge } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from './AuthContext';
import { ProcessContext } from './ProcessContext';
import { useUserAccount, useUpdatePreferences, useApiKeys, useCreateApiKey, useDeleteApiKey } from './datamodel/useAuthQueries';
import { useProjects } from './datamodel/useQueries';

export default function AccountPage() {
  const { user, updateUser } = useContext(AuthContext);
  const { setActiveProcess } = useContext(ProcessContext);
  const navigate = useNavigate();
  const { data: accountData, refetch } = useUserAccount();
  const updatePrefsMutation = useUpdatePreferences();
  const { data: apiKeys = [], isLoading: keysLoading } = useApiKeys();
  const createKeyMutation = useCreateApiKey();
  const deleteKeyMutation = useDeleteApiKey();
  const { data: projects = [] } = useProjects();

  const [preferences, setPreferences] = useState({});
  const [isEditing, setIsEditing] = useState(false);

  // New key form state
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newKeyProject, setNewKeyProject] = useState('');
  const [newKeyExpiry, setNewKeyExpiry] = useState('');
  const [keyCreateError, setKeyCreateError] = useState('');

  // One-time reveal modal
  const [revealedKey, setRevealedKey] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    if (accountData) {
      setPreferences(accountData.preferences || {});
    }
  }, [accountData]);

  useEffect(() => {
    if (projects.length > 0 && !newKeyProject) {
      setNewKeyProject(projects[0].id);
    }
  }, [projects]);

  const handleSavePreferences = async () => {
    try {
      const updated = await updatePrefsMutation.mutateAsync(preferences);
      updateUser(updated);
      setIsEditing(false);
    } catch {
      alert('Failed to save preferences');
    }
  };

  const handleTransactionClick = (transaction) => {
    if (transaction.process_id) {
      setActiveProcess({ processId: transaction.process_id, version: transaction.process_version || 1 });
      navigate('/app');
    }
  };

  const handleCreateKey = async (e) => {
    e.preventDefault();
    setKeyCreateError('');
    if (!newKeyLabel.trim()) {
      setKeyCreateError('Label is required');
      return;
    }
    if (!newKeyProject) {
      setKeyCreateError('Project is required');
      return;
    }
    try {
      const result = await createKeyMutation.mutateAsync({
        label: newKeyLabel.trim(),
        projectId: newKeyProject,
        expiresAt: newKeyExpiry || null,
      });
      setRevealedKey(result.key);
      setCopied(false);
      setNewKeyLabel('');
      setNewKeyExpiry('');
    } catch (err) {
      setKeyCreateError(err?.response?.data?.detail || 'Failed to create API key');
    }
  };

  const handleDeleteKey = async (keyId) => {
    if (!window.confirm('Revoke this API key? This cannot be undone.')) return;
    try {
      await deleteKeyMutation.mutateAsync(keyId);
    } catch {
      alert('Failed to revoke API key');
    }
  };

  const handleCopyKey = () => {
    navigator.clipboard.writeText(revealedKey).then(() => setCopied(true));
  };

  if (!accountData) {
    return <Container className="mt-4"><p>Loading...</p></Container>;
  }

  return (
    <Container className="mt-4">
      <h2>Account</h2>

      <Card className="mb-4">
        <Card.Body>
          <Card.Title>User Information</Card.Title>
          <p><strong>Username:</strong> {user.username}</p>
          <p><strong>Current Balance:</strong> ${accountData.balance.toFixed(2)}</p>
        </Card.Body>
      </Card>

      <Card className="mb-4">
        <Card.Body>
          <Card.Title>
            Preferences
            {!isEditing && (
              <Button size="sm" className="ms-2" onClick={() => setIsEditing(true)}>Edit</Button>
            )}
          </Card.Title>
          {isEditing ? (
            <Form>
              <Form.Group className="mb-3">
                <Form.Label>Email</Form.Label>
                <Form.Control
                  type="email"
                  value={preferences.email || ''}
                  onChange={e => setPreferences({ ...preferences, email: e.target.value })}
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Notification Preferences</Form.Label>
                <Form.Check
                  type="checkbox"
                  label="Email notifications"
                  checked={preferences.email_notifications || false}
                  onChange={e => setPreferences({ ...preferences, email_notifications: e.target.checked })}
                />
              </Form.Group>
              <Button onClick={handleSavePreferences}>Save</Button>
              <Button variant="secondary" className="ms-2" onClick={() => setIsEditing(false)}>Cancel</Button>
            </Form>
          ) : (
            <div>
              <p><strong>Email:</strong> {preferences.email || 'Not set'}</p>
              <p><strong>Email Notifications:</strong> {preferences.email_notifications ? 'Enabled' : 'Disabled'}</p>
            </div>
          )}
        </Card.Body>
      </Card>

      <Card className="mb-4">
        <Card.Body>
          <Card.Title>API Keys</Card.Title>
          <p className="text-muted small">
            API keys grant programmatic access scoped to a single project. Treat them like passwords.
          </p>

          {/* Create new key form */}
          <Form onSubmit={handleCreateKey} className="mb-3 p-3 border rounded bg-light">
            <h6>Create new API key</h6>
            {keyCreateError && <Alert variant="danger" className="py-2">{keyCreateError}</Alert>}
            <div className="d-flex gap-2 flex-wrap align-items-end">
              <Form.Group>
                <Form.Label className="small mb-1">Label</Form.Label>
                <Form.Control
                  size="sm"
                  placeholder="e.g. MCP server"
                  value={newKeyLabel}
                  onChange={e => setNewKeyLabel(e.target.value)}
                  style={{ width: 180 }}
                />
              </Form.Group>
              <Form.Group>
                <Form.Label className="small mb-1">Project</Form.Label>
                <Form.Select
                  size="sm"
                  value={newKeyProject}
                  onChange={e => setNewKeyProject(e.target.value)}
                  style={{ width: 200 }}
                >
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Form.Select>
              </Form.Group>
              <Form.Group>
                <Form.Label className="small mb-1">Expires (optional)</Form.Label>
                <Form.Control
                  size="sm"
                  type="date"
                  value={newKeyExpiry}
                  onChange={e => setNewKeyExpiry(e.target.value)}
                  style={{ width: 160 }}
                />
              </Form.Group>
              <Button type="submit" size="sm" disabled={createKeyMutation.isPending}>
                {createKeyMutation.isPending ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </Form>

          {/* Key list */}
          {keysLoading ? (
            <p className="text-muted">Loading…</p>
          ) : apiKeys.length === 0 ? (
            <p className="text-muted">No API keys yet.</p>
          ) : (
            <Table size="sm" hover>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Project</th>
                  <th>Created</th>
                  <th>Expires</th>
                  <th>Last used</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map(k => {
                  const expired = k.expires_at && new Date(k.expires_at) < new Date();
                  return (
                    <tr key={k.id}>
                      <td>{k.label}</td>
                      <td>{k.project_name || k.project_id}</td>
                      <td>{new Date(k.created_at).toLocaleDateString()}</td>
                      <td>
                        {k.expires_at ? (
                          <span className={expired ? 'text-danger' : ''}>
                            {new Date(k.expires_at).toLocaleDateString()}
                            {expired && <Badge bg="danger" className="ms-1">Expired</Badge>}
                          </span>
                        ) : (
                          <span className="text-muted">Never</span>
                        )}
                      </td>
                      <td>{k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : <span className="text-muted">Never</span>}</td>
                      <td>
                        <Button
                          size="sm"
                          variant="outline-danger"
                          onClick={() => handleDeleteKey(k.id)}
                          disabled={deleteKeyMutation.isPending}
                        >
                          Revoke
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <Card.Title>Transaction History</Card.Title>
          <Table striped hover>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Description</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {accountData.transactions.map((tx, idx) => (
                <tr
                  key={idx}
                  onClick={() => handleTransactionClick(tx)}
                  style={tx.process_id ? { cursor: 'pointer' } : {}}
                >
                  <td>{new Date(tx.timestamp).toLocaleString()}</td>
                  <td>{tx.type}</td>
                  <td>
                    {tx.process_name ? (
                      <span className="text-primary">{tx.process_name} (v{tx.process_version})</span>
                    ) : (
                      tx.description
                    )}
                  </td>
                  <td className={tx.amount > 0 ? 'text-success' : 'text-danger'}>
                    {tx.amount > 0 ? '+' : ''}{tx.amount.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      <div className="mt-3">
        <Button variant="secondary" onClick={() => navigate('/app')}>Back to App</Button>
      </div>

      {/* One-time key reveal modal */}
      <Modal show={!!revealedKey} onHide={() => setRevealedKey(null)} backdrop="static">
        <Modal.Header closeButton>
          <Modal.Title>API Key Created</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Alert variant="warning" className="py-2">
            Copy this key now — it will not be shown again.
          </Alert>
          <Form.Control
            readOnly
            value={revealedKey || ''}
            className="font-monospace"
            style={{ fontSize: 13 }}
            onFocus={e => e.target.select()}
          />
          <Button variant="outline-secondary" size="sm" className="mt-2" onClick={handleCopyKey}>
            {copied ? 'Copied!' : 'Copy to clipboard'}
          </Button>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={() => setRevealedKey(null)}>Done</Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
}
