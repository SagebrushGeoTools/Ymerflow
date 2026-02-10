import React, { useContext, useEffect, useState } from 'react';
import { Container, Card, Table, Button, Form } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from './AuthContext';
import { ProcessContext } from './ProcessContext';
import { useUserAccount, useUpdatePreferences } from './datamodel/useAuthQueries';

export default function AccountPage() {
  const { user, updateUser } = useContext(AuthContext);
  const { setActiveProcess } = useContext(ProcessContext);
  const navigate = useNavigate();
  const { data: accountData, refetch } = useUserAccount();
  const updatePrefsMutation = useUpdatePreferences();

  const [preferences, setPreferences] = useState({});
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    if (accountData) {
      setPreferences(accountData.preferences || {});
    }
  }, [accountData]);

  const handleSavePreferences = async () => {
    try {
      const updated = await updatePrefsMutation.mutateAsync(preferences);
      updateUser(updated);
      setIsEditing(false);
      alert('Preferences saved');
    } catch (error) {
      alert('Failed to save preferences');
    }
  };

  const handleTransactionClick = (transaction) => {
    if (transaction.process_id) {
      setActiveProcess({
        processId: transaction.process_id,
        version: transaction.process_version || 1
      });
      navigate('/app');
    }
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
              <Button size="sm" className="ms-2" onClick={() => setIsEditing(true)}>
                Edit
              </Button>
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
              <Button variant="secondary" className="ms-2" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
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
                      <span className="text-primary">
                        {tx.process_name} (v{tx.process_version})
                      </span>
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
        <Button variant="secondary" onClick={() => navigate('/app')}>
          Back to App
        </Button>
      </div>
    </Container>
  );
}
