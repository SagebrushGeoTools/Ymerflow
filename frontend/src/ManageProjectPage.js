import React, { useContext, useState } from 'react';
import { Container, Card, Table, Button, Form, Badge, Spinner, Alert } from 'react-bootstrap';
import { useNavigate, useParams } from 'react-router-dom';
import { AuthContext } from './AuthContext';
import { ProcessContext } from './ProcessContext';
import {
  useProjectMembers,
  useInviteProjectMember,
  useUpdateProjectMemberRole,
  useRemoveProjectMember,
} from './datamodel/useQueries';

export default function ManageProjectPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const { projects } = useContext(ProcessContext);

  const project = projects.find(p => p.id === projectId);
  const myRole = project?.my_role;
  const isAdmin = myRole === 'admin';

  const { data: members = [], isLoading, error } = useProjectMembers(projectId);
  const inviteMutation = useInviteProjectMember(projectId);
  const updateRoleMutation = useUpdateProjectMemberRole(projectId);
  const removeMutation = useRemoveProjectMember(projectId);

  const [inviteUsername, setInviteUsername] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteError, setInviteError] = useState('');

  const handleInvite = async (e) => {
    e.preventDefault();
    setInviteError('');
    try {
      await inviteMutation.mutateAsync({ username: inviteUsername.trim(), role: inviteRole });
      setInviteUsername('');
      setInviteRole('member');
    } catch (err) {
      setInviteError(err.response?.data?.detail || 'Failed to invite user');
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      await updateRoleMutation.mutateAsync({ userId, role: newRole });
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to update role');
    }
  };

  const handleRemove = async (userId, username) => {
    if (!window.confirm(`Remove ${username} from this project?`)) return;
    try {
      await removeMutation.mutateAsync(userId);
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to remove member');
    }
  };

  if (!project) {
    return (
      <Container className="mt-4">
        <p>Project not found or you do not have access.</p>
        <Button variant="secondary" onClick={() => navigate('/app')}>Back to App</Button>
      </Container>
    );
  }

  return (
    <Container className="mt-4">
      <h2>Manage Project: {project.name}</h2>
      <p className="text-muted">Your role: <Badge bg={isAdmin ? 'primary' : 'secondary'}>{myRole}</Badge></p>

      <Card className="mb-4">
        <Card.Body>
          <Card.Title>Members</Card.Title>
          {isLoading && <Spinner animation="border" size="sm" />}
          {error && <Alert variant="danger">Failed to load members</Alert>}
          {!isLoading && !error && (
            <Table striped hover>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Role</th>
                  {isAdmin && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {members.map(member => {
                  const isSelf = member.username === user?.username;
                  return (
                    <tr key={member.user_id}>
                      <td>
                        {member.username}
                        {isSelf && <Badge bg="info" className="ms-2">You</Badge>}
                      </td>
                      <td>
                        {isAdmin && !isSelf ? (
                          <Form.Select
                            size="sm"
                            value={member.role}
                            onChange={e => handleRoleChange(member.user_id, e.target.value)}
                            style={{ width: 'auto' }}
                            disabled={updateRoleMutation.isPending}
                          >
                            <option value="member">member</option>
                            <option value="admin">admin</option>
                          </Form.Select>
                        ) : (
                          <Badge bg={member.role === 'admin' ? 'primary' : 'secondary'}>
                            {member.role}
                          </Badge>
                        )}
                      </td>
                      {isAdmin && (
                        <td>
                          {!isSelf && (
                            <Button
                              variant="outline-danger"
                              size="sm"
                              onClick={() => handleRemove(member.user_id, member.username)}
                              disabled={removeMutation.isPending}
                            >
                              Remove
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      {isAdmin && (
        <Card className="mb-4">
          <Card.Body>
            <Card.Title>Invite User</Card.Title>
            <Form onSubmit={handleInvite}>
              <Form.Group className="mb-3">
                <Form.Label>Username</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="Enter username"
                  value={inviteUsername}
                  onChange={e => setInviteUsername(e.target.value)}
                  required
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Role</Form.Label>
                <Form.Select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value)}
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </Form.Select>
              </Form.Group>
              {inviteError && <Alert variant="danger">{inviteError}</Alert>}
              <Button type="submit" disabled={inviteMutation.isPending || !inviteUsername.trim()}>
                {inviteMutation.isPending ? 'Inviting...' : 'Invite'}
              </Button>
            </Form>
          </Card.Body>
        </Card>
      )}

      <Button variant="secondary" onClick={() => navigate('/app')}>
        Back to App
      </Button>
    </Container>
  );
}
