import React, { useContext, useEffect, useState } from 'react';
import { Container, Card, Table, Button, Form, Modal, Alert, Badge, Tab, Nav } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from './AuthContext';
import { ProcessContext } from './ProcessContext';
import { useUserAccount, useUpdatePreferences, useApiKeys, useCreateApiKey, useDeleteApiKey } from './datamodel/useAuthQueries';
import { useProjects } from './datamodel/useQueries';
import { API } from './datamodel/api';

const MCP_URL = `${API}/mcp`;

function McpConfigCard({ apiKeys }) {
  const [selectedKeyId, setSelectedKeyId] = useState('');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);

  // Auto-select first non-expired key
  useEffect(() => {
    if (!selectedKeyId && apiKeys.length > 0) {
      const valid = apiKeys.find(k => !k.expires_at || new Date(k.expires_at) > new Date());
      if (valid) setSelectedKeyId(valid.id);
    }
  }, [apiKeys, selectedKeyId]);

  const selectedKey = apiKeys.find(k => k.id === selectedKeyId);

  const configJson = JSON.stringify({
    mcp: {
      servers: {
        nagelfluh: {
          type: 'sse',
          url: MCP_URL,
          headers: {
            Authorization: `Bearer ${selectedKey ? '<paste-your-key-here>... (select key above)' : '<create-an-api-key-below>'}`,
          },
        },
      },
    },
  }, null, 2);

  // Build the real config with the actual key value — only possible when key was just created
  // (key_hash is never returned after creation). We show a note about this.
  const configWithPlaceholder = JSON.stringify({
    mcp: {
      servers: {
        nagelfluh: {
          type: 'sse',
          url: MCP_URL,
          headers: {
            Authorization: 'Bearer <your-api-key>',
          },
        },
      },
    },
  }, null, 2);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(MCP_URL).then(() => {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    });
  };

  const handleCopyConfig = () => {
    navigator.clipboard.writeText(configWithPlaceholder).then(() => {
      setCopiedConfig(true);
      setTimeout(() => setCopiedConfig(false), 2000);
    });
  };

  return (
    <div>
      <h6 className="mb-2">MCP Server</h6>
      <p className="text-muted small mb-3">
        Connect AI tools (Claude Code, opencode) to this project using the Model Context Protocol.
      </p>

      {/* URL row */}
      <div className="d-flex align-items-center gap-2 mb-3">
        <span className="text-muted small fw-semibold" style={{ whiteSpace: 'nowrap' }}>Server URL</span>
        <code
          className="flex-grow-1 px-2 py-1 rounded"
          style={{ background: '#f6f8fa', fontSize: 13, wordBreak: 'break-all' }}
        >
          {MCP_URL}
        </code>
        <Button size="sm" variant="outline-secondary" onClick={handleCopyUrl} style={{ whiteSpace: 'nowrap' }}>
          {copiedUrl ? 'Copied!' : 'Copy URL'}
        </Button>
      </div>

      {/* Config snippet */}
      <p className="small fw-semibold mb-1">
        Claude Code config{' '}
        <span className="text-muted fw-normal">
          — paste into <code>.claude/settings.json</code> or <code>~/.claude/settings.json</code>
        </span>
      </p>
      <div className="position-relative">
        <pre
          className="rounded p-3 mb-1"
          style={{ background: '#f6f8fa', fontSize: 12, overflowX: 'auto' }}
        >
{`{
  "mcp": {
    "servers": {
      "nagelfluh": {
        "type": "sse",
        "url": "${MCP_URL}",
        "headers": {
          "Authorization": "Bearer <your-api-key>"
        }
      }
    }
  }
}`}
        </pre>
      </div>
      <div className="d-flex align-items-center gap-2">
        <Button size="sm" variant="outline-secondary" onClick={handleCopyConfig}>
          {copiedConfig ? 'Copied!' : 'Copy config'}
        </Button>
        <span className="text-muted small">
          Replace <code>&lt;your-api-key&gt;</code> with a key from the table above.
        </span>
      </div>
    </div>
  );
}

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
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedFullConfig, setCopiedFullConfig] = useState(false);

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
    if (!newKeyLabel.trim()) { setKeyCreateError('Label is required'); return; }
    if (!newKeyProject) { setKeyCreateError('Project is required'); return; }
    try {
      const result = await createKeyMutation.mutateAsync({
        label: newKeyLabel.trim(),
        projectId: newKeyProject,
        expiresAt: newKeyExpiry || null,
      });
      setRevealedKey(result.key);
      setCopiedKey(false);
      setCopiedFullConfig(false);
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
    navigator.clipboard.writeText(revealedKey).then(() => setCopiedKey(true));
  };

  const fullConfig = revealedKey
    ? JSON.stringify({
        mcp: {
          servers: {
            nagelfluh: {
              type: 'sse',
              url: MCP_URL,
              headers: { Authorization: `Bearer ${revealedKey}` },
            },
          },
        },
      }, null, 2)
    : '';

  const handleCopyFullConfig = () => {
    navigator.clipboard.writeText(fullConfig).then(() => setCopiedFullConfig(true));
  };

  if (!accountData) {
    return <Container className="mt-4"><p>Loading...</p></Container>;
  }

  return (
    <Container className="mt-4">
      <h2 className="mb-3">Account</h2>

      <Tab.Container defaultActiveKey="profile">
        <Nav variant="tabs" className="mb-3">
          <Nav.Item>
            <Nav.Link eventKey="profile">Profile &amp; History</Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link eventKey="api">API Keys &amp; MCP</Nav.Link>
          </Nav.Item>
        </Nav>

        <Tab.Content>
          <Tab.Pane eventKey="profile">
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
          </Tab.Pane>

          <Tab.Pane eventKey="api">
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

                {/* MCP server config — shown below the keys table */}
                <hr />
                <McpConfigCard apiKeys={apiKeys} />
              </Card.Body>
            </Card>
          </Tab.Pane>
        </Tab.Content>
      </Tab.Container>

      <div className="mt-3">
        <Button variant="secondary" onClick={() => navigate('/app')}>Back to App</Button>
      </div>

      {/* One-time key reveal modal */}
      <Modal show={!!revealedKey} onHide={() => setRevealedKey(null)} backdrop="static" size="lg">
        <Modal.Header closeButton>
          <Modal.Title>API Key Created</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Alert variant="warning" className="py-2">
            Copy this key now — it will not be shown again.
          </Alert>

          {/* Raw key */}
          <p className="small fw-semibold mb-1">API key</p>
          <div className="d-flex gap-2 mb-3">
            <Form.Control
              readOnly
              value={revealedKey || ''}
              className="font-monospace"
              style={{ fontSize: 13 }}
              onFocus={e => e.target.select()}
            />
            <Button variant="outline-secondary" onClick={handleCopyKey} style={{ whiteSpace: 'nowrap' }}>
              {copiedKey ? 'Copied!' : 'Copy key'}
            </Button>
          </div>

          {/* Ready-to-paste Claude Code config */}
          <p className="small fw-semibold mb-1">
            Claude Code config{' '}
            <span className="text-muted fw-normal">— paste into <code>.claude/settings.json</code></span>
          </p>
          <pre
            className="rounded p-3 mb-2"
            style={{ background: '#f6f8fa', fontSize: 12, overflowX: 'auto' }}
          >
            {fullConfig}
          </pre>
          <Button variant="outline-secondary" size="sm" onClick={handleCopyFullConfig}>
            {copiedFullConfig ? 'Copied!' : 'Copy Claude Code config'}
          </Button>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={() => setRevealedKey(null)}>Done</Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
}
