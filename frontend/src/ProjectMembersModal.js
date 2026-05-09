import React, { useState, useContext } from 'react';
import { Modal, Tab, Tabs, Table, Button, Form, InputGroup, Spinner, Alert } from 'react-bootstrap';
import { ProcessContext } from './ProcessContext';
import {
  useProjectMembers,
  useProjectInvites,
  useInviteMember,
  useCancelInvite,
  useLeaveProject,
} from './datamodel/useQueries';

export default function ProjectMembersModal({ show, onHide, projectId, projectName }) {
  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Members — {projectName}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Tabs defaultActiveKey="members" className="mb-3">
          <Tab eventKey="members" title="Members">
            <MembersTab projectId={projectId} onHide={onHide} />
          </Tab>
          <Tab eventKey="invite" title="Invite">
            <InviteTab projectId={projectId} />
          </Tab>
          <Tab eventKey="pending" title="Pending Invites">
            <PendingInvitesTab projectId={projectId} />
          </Tab>
        </Tabs>
      </Modal.Body>
    </Modal>
  );
}

function MembersTab({ projectId, onHide }) {
  const { setCurrentProject } = useContext(ProcessContext);
  const { data: members = [], isLoading } = useProjectMembers(projectId);
  const leaveProject = useLeaveProject(projectId);

  const handleLeave = async () => {
    if (!window.confirm('Are you sure you want to leave this project?')) return;
    try {
      await leaveProject.mutateAsync();
      setCurrentProject(null);
      onHide();
    } catch (error) {
      alert('Failed to leave project: ' + (error.response?.data?.detail || error.message));
    }
  };

  if (isLoading) return <Spinner animation="border" />;

  return (
    <>
      <Table size="sm" hover>
        <thead>
          <tr>
            <th>Username</th>
            <th>Email</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>
          {members.map(m => (
            <tr key={m.user_id}>
              <td>{m.username}</td>
              <td>{m.email || '—'}</td>
              <td>{new Date(m.joined_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Button
        variant="outline-danger"
        size="sm"
        onClick={handleLeave}
        disabled={leaveProject.isPending}
      >
        Leave Project
      </Button>
    </>
  );
}

function InviteTab({ projectId }) {
  const [email, setEmail] = useState('');
  const [inviteResult, setInviteResult] = useState(null);
  const [error, setError] = useState(null);
  const inviteMember = useInviteMember(projectId);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError(null);
    setInviteResult(null);
    try {
      const result = await inviteMember.mutateAsync(email || null);
      setInviteResult(result);
      setEmail('');
    } catch (err) {
      setError(err.response?.data?.detail || err.message);
    }
  };

  const handleCopy = () => {
    if (inviteResult?.invite_url) {
      navigator.clipboard.writeText(inviteResult.invite_url);
    }
  };

  return (
    <>
      <Form onSubmit={handleCreate}>
        <Form.Group className="mb-3">
          <Form.Label>Email (optional)</Form.Label>
          <Form.Control
            type="email"
            placeholder="colleague@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <Form.Text className="text-muted">
            Leave blank to create a link-only invite.
          </Form.Text>
        </Form.Group>
        <Button type="submit" disabled={inviteMember.isPending}>
          {inviteMember.isPending ? <Spinner animation="border" size="sm" /> : 'Create Invite Link'}
        </Button>
      </Form>

      {error && <Alert variant="danger" className="mt-3">{error}</Alert>}

      {inviteResult && (
        <Alert variant="success" className="mt-3">
          <p className="mb-2">
            <strong>Invite link created!</strong>
            {inviteResult.email && <span> Email sent to {inviteResult.email}.</span>}
          </p>
          <InputGroup>
            <Form.Control
              readOnly
              value={inviteResult.invite_url}
              onClick={e => e.target.select()}
            />
            <Button variant="outline-secondary" onClick={handleCopy}>
              Copy
            </Button>
          </InputGroup>
        </Alert>
      )}
    </>
  );
}

function PendingInvitesTab({ projectId }) {
  const { data: invites = [], isLoading } = useProjectInvites(projectId);
  const cancelInvite = useCancelInvite(projectId);

  const handleCancel = async (inviteId) => {
    if (!window.confirm('Cancel this invite?')) return;
    try {
      await cancelInvite.mutateAsync(inviteId);
    } catch (error) {
      alert('Failed to cancel invite: ' + (error.response?.data?.detail || error.message));
    }
  };

  if (isLoading) return <Spinner animation="border" />;
  if (invites.length === 0) return <p className="text-muted">No pending invites.</p>;

  return (
    <Table size="sm" hover>
      <thead>
        <tr>
          <th>Email</th>
          <th>Sent</th>
          <th>Expires</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {invites.map(inv => (
          <tr key={inv.id}>
            <td>{inv.email || <em>link-only</em>}</td>
            <td>{new Date(inv.created_at).toLocaleDateString()}</td>
            <td>{new Date(inv.expires_at).toLocaleDateString()}</td>
            <td>
              <Button
                size="sm"
                variant="outline-danger"
                onClick={() => handleCancel(inv.id)}
                disabled={cancelInvite.isPending}
              >
                Cancel
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
