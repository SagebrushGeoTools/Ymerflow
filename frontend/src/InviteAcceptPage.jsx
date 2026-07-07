import React, { useContext, useEffect } from 'react';
import { Container, Card, Button, Spinner } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { ProcessContext } from './ProcessContext';
import { useInviteInfo, useAcceptInvite } from './datamodel/useQueries';

export default function InviteAcceptPage({ token }) {
  const navigate = useNavigate();
  const { invalidateProject } = useContext(ProcessContext);
  const { data: inviteInfo, isLoading, isError } = useInviteInfo(token);
  const acceptInvite = useAcceptInvite();

  const handleAccept = async () => {
    try {
      const result = await acceptInvite.mutateAsync(token);
      sessionStorage.removeItem('pendingInviteToken');
      if (result?.project_id) {
        await invalidateProject(result.project_id);
      }
      navigate('/app');
    } catch (error) {
      alert('Failed to accept invitation: ' + (error.response?.data?.detail || error.message));
    }
  };

  if (isLoading) {
    return (
      <Container className="d-flex align-items-center justify-content-center min-vh-100">
        <Spinner animation="border" />
      </Container>
    );
  }

  if (isError || !inviteInfo) {
    return (
      <Container className="d-flex align-items-center justify-content-center min-vh-100">
        <Card style={{ maxWidth: 400, width: '100%' }}>
          <Card.Header>Invalid Invitation</Card.Header>
          <Card.Body>
            <p>This invitation link is invalid or has expired.</p>
            <Button variant="primary" onClick={() => navigate('/app')}>
              Go to App
            </Button>
          </Card.Body>
        </Card>
      </Container>
    );
  }

  return (
    <Container className="d-flex align-items-center justify-content-center min-vh-100">
      <Card style={{ maxWidth: 400, width: '100%' }}>
        <Card.Header>Project Invitation</Card.Header>
        <Card.Body>
          <p>
            {inviteInfo.inviter
              ? <><strong>{inviteInfo.inviter}</strong> has invited you to join </>
              : <>You have been invited to join </>}
            <strong>{inviteInfo.project_name}</strong>.
          </p>
          <Button
            variant="success"
            onClick={handleAccept}
            disabled={acceptInvite.isPending}
            className="w-100"
          >
            {acceptInvite.isPending ? <Spinner animation="border" size="sm" /> : 'Accept Invitation'}
          </Button>
          <Button
            variant="link"
            className="w-100 mt-2"
            onClick={() => navigate('/app')}
          >
            Decline
          </Button>
        </Card.Body>
      </Card>
    </Container>
  );
}
