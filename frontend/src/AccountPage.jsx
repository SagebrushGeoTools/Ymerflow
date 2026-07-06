import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Container, Card, Table, Button, Form, Modal, Alert, Badge, Tab, Nav } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from './AuthContext';
import { ProcessContext } from './ProcessContext';
import { useUserAccount, useUpdatePreferences, useUpdateEmail, useApiKeys, useCreateApiKey, useDeleteApiKey, useAdminUsers, useSetUserAdmin } from './datamodel/useAuthQueries';
import { useProjects } from './datamodel/useQueries';
import { ABSOLUTE_API } from './datamodel/api';
import { hooks } from './plugins/hooks';

const MCP_URL = `${ABSOLUTE_API}/mcp`;

function McpConfigCard({ apiKeys }) {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedMcpJson, setCopiedMcpJson] = useState(false);

  const cliCommand = `claude mcp add --scope user --transport http nagelfluh ${MCP_URL} --header "Authorization: Bearer <your-api-key>"`;

  const mcpJson = JSON.stringify({
    mcpServers: {
      nagelfluh: {
        type: 'http',
        url: MCP_URL,
        headers: { Authorization: 'Bearer <your-api-key>' },
      },
    },
  }, null, 2);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(MCP_URL).then(() => {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    });
  };

  const handleCopyCmd = () => {
    navigator.clipboard.writeText(cliCommand).then(() => {
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2000);
    });
  };

  const handleCopyMcpJson = () => {
    navigator.clipboard.writeText(mcpJson).then(() => {
      setCopiedMcpJson(true);
      setTimeout(() => setCopiedMcpJson(false), 2000);
    });
  };

  return (
    <div>
      <h6 className="mb-2">MCP Server</h6>
      <p className="text-muted small mb-3">
        Connect AI tools (Claude Code, opencode) to this project using the Model Context Protocol.
      </p>

      {/* URL row */}
      <div className="d-flex align-items-center gap-2 mb-4">
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

      {/* Claude Code CLI */}
      <p className="small fw-semibold mb-1">
        Claude Code CLI{' '}
        <span className="text-muted fw-normal">— run once to register globally</span>
      </p>
      <div className="d-flex align-items-start gap-2 mb-4">
        <pre
          className="flex-grow-1 rounded px-3 py-2 mb-0"
          style={{ background: '#f6f8fa', fontSize: 12, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
        >
          {cliCommand}
        </pre>
        <Button size="sm" variant="outline-secondary" onClick={handleCopyCmd} style={{ whiteSpace: 'nowrap', marginTop: 2 }}>
          {copiedCmd ? 'Copied!' : 'Copy'}
        </Button>
      </div>

      {/* .mcp.json */}
      <p className="small fw-semibold mb-1">
        Project config{' '}
        <span className="text-muted fw-normal">
          — save as <code>.mcp.json</code> in your project root, then add{' '}
          <code>"enabledMcpjsonServers": ["nagelfluh"]</code> to <code>.claude/settings.json</code>
        </span>
      </p>
      <div className="d-flex align-items-start gap-2">
        <pre
          className="flex-grow-1 rounded p-3 mb-0"
          style={{ background: '#f6f8fa', fontSize: 12, overflowX: 'auto' }}
        >
          {mcpJson}
        </pre>
        <Button size="sm" variant="outline-secondary" onClick={handleCopyMcpJson} style={{ whiteSpace: 'nowrap', marginTop: 2 }}>
          {copiedMcpJson ? 'Copied!' : 'Copy'}
        </Button>
      </div>
      <p className="text-muted small mt-2 mb-0">
        Replace <code>&lt;your-api-key&gt;</code> with a key from the table above.
      </p>
    </div>
  );
}

function UsersAdminPanel({ currentUser }) {
  const { data: users = [], isLoading } = useAdminUsers();
  const setAdminMutation = useSetUserAdmin();

  if (isLoading) return <p className="text-muted">Loading...</p>;

  return (
    <Card>
      <Card.Body>
        <Card.Title>User Administration</Card.Title>
        <Table size="sm" hover>
          <thead>
            <tr>
              <th>Username</th>
              <th>Email</th>
              <th>Admin?</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.username}>
                <td>{u.username}</td>
                <td>{u.email || <span className="text-muted">—</span>}</td>
                <td>{u.is_admin ? <Badge bg="success">Admin</Badge> : null}</td>
                <td>
                  <Button
                    size="sm"
                    variant={u.is_admin ? 'outline-danger' : 'outline-primary'}
                    disabled={u.username === currentUser.username || setAdminMutation.isPending}
                    onClick={() => setAdminMutation.mutate({ username: u.username, isAdmin: !u.is_admin })}
                  >
                    {u.is_admin ? 'Revoke admin' : 'Make admin'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card.Body>
    </Card>
  );
}

function AdminTab({ currentUser }) {
  const adminTabs = useMemo(() => hooks.run.admin_tabs(), []);

  if (adminTabs.length === 0) {
    return <UsersAdminPanel currentUser={currentUser} />;
  }

  return (
    <Tab.Container defaultActiveKey="users">
      <Nav variant="tabs" className="mb-3">
        <Nav.Item>
          <Nav.Link eventKey="users">Users</Nav.Link>
        </Nav.Item>
        {adminTabs.map(({ key, title }) => (
          <Nav.Item key={key}>
            <Nav.Link eventKey={key}>{title}</Nav.Link>
          </Nav.Item>
        ))}
      </Nav>
      <Tab.Content>
        <Tab.Pane eventKey="users">
          <UsersAdminPanel currentUser={currentUser} />
        </Tab.Pane>
        {adminTabs.map(({ key, Component }) => (
          <Tab.Pane key={key} eventKey={key}>
            <Component />
          </Tab.Pane>
        ))}
      </Tab.Content>
    </Tab.Container>
  );
}

export default function AccountPage() {
  const { user, updateUser } = useContext(AuthContext);
  const { setActiveProcess } = useContext(ProcessContext);
  const navigate = useNavigate();
  const { data: accountData, refetch } = useUserAccount();
  const updatePrefsMutation = useUpdatePreferences();
  const updateEmailMutation = useUpdateEmail();
  const { data: apiKeys = [], isLoading: keysLoading } = useApiKeys();
  const createKeyMutation = useCreateApiKey();
  const deleteKeyMutation = useDeleteApiKey();
  const { data: projects = [] } = useProjects();

  const [preferences, setPreferences] = useState({});
  const [email, setEmail] = useState('');
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
      setEmail(accountData.email || '');
    }
  }, [accountData]);

  useEffect(() => {
    if (projects.length > 0 && !newKeyProject) {
      setNewKeyProject(projects[0].id);
    }
  }, [projects]);

  const handleSaveProfile = async () => {
    try {
      const updatedFromEmail = await updateEmailMutation.mutateAsync(email || null);
      const updated = await updatePrefsMutation.mutateAsync(preferences);
      updateUser(updated);
      setEmail(updatedFromEmail.email || '');
      setIsEditing(false);
    } catch (err) {
      alert(err?.response?.data?.detail || 'Failed to save profile');
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
    ? `claude mcp add --scope user --transport http nagelfluh ${MCP_URL} --header "Authorization: Bearer ${revealedKey}"`
    : '';

  const handleCopyFullConfig = () => {
    navigator.clipboard.writeText(fullConfig).then(() => setCopiedFullConfig(true));
  };

  // Plugin-contributed account tabs; stable since plugin registrations don't change after startup.
  const extraTabs = useMemo(() => hooks.run.account_tabs(), []);

  if (!accountData) {
    return <Container className="mt-4"><p>Loading...</p></Container>;
  }

  return (
    <Container className="mt-4">
      <h2 className="mb-3">Account</h2>

      <Tab.Container defaultActiveKey="profile">
        <Nav variant="tabs" className="mb-3">
          <Nav.Item>
            <Nav.Link eventKey="profile">Profile</Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link eventKey="api">API Keys &amp; MCP</Nav.Link>
          </Nav.Item>
          {extraTabs.map(({ key, title }) => (
            <Nav.Item key={key}>
              <Nav.Link eventKey={key}>{title}</Nav.Link>
            </Nav.Item>
          ))}
          {user.is_admin && (
            <Nav.Item>
              <Nav.Link eventKey="admin">Admin</Nav.Link>
            </Nav.Item>
          )}
        </Nav>

        <Tab.Content>
          <Tab.Pane eventKey="profile">
            <Card className="mb-4">
              <Card.Body>
                <Card.Title>User Information</Card.Title>
                <p><strong>Username:</strong> {user.username}</p>
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
                        value={email}
                        onChange={e => setEmail(e.target.value)}
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
                    <Button onClick={handleSaveProfile}>Save</Button>
                    <Button variant="secondary" className="ms-2" onClick={() => setIsEditing(false)}>Cancel</Button>
                  </Form>
                ) : (
                  <div>
                    <p><strong>Email:</strong> {email || 'Not set'}</p>
                    <p><strong>Email Notifications:</strong> {preferences.email_notifications ? 'Enabled' : 'Disabled'}</p>
                  </div>
                )}
              </Card.Body>
            </Card>
          </Tab.Pane>

          {extraTabs.map(({ key, Component }) => (
            <Tab.Pane key={key} eventKey={key}>
              <Component accountData={accountData} onTransactionClick={handleTransactionClick} />
            </Tab.Pane>
          ))}

          {user.is_admin && (
            <Tab.Pane eventKey="admin">
              <AdminTab currentUser={user} />
            </Tab.Pane>
          )}

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

          {/* Ready-to-run Claude Code CLI command */}
          <p className="small fw-semibold mb-1">
            Claude Code CLI{' '}
            <span className="text-muted fw-normal">— run once to register globally</span>
          </p>
          <pre
            className="rounded p-3 mb-2"
            style={{ background: '#f6f8fa', fontSize: 12, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
          >
            {fullConfig}
          </pre>
          <Button variant="outline-secondary" size="sm" onClick={handleCopyFullConfig}>
            {copiedFullConfig ? 'Copied!' : 'Copy command'}
          </Button>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={() => setRevealedKey(null)}>Done</Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
}
