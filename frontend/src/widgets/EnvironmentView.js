import React, { useState, useContext } from 'react';
import { Modal, Button, Table, Alert } from 'react-bootstrap';
import { ProcessContext } from '../ProcessContext';

export default function EnvironmentView() {
  const { environments, environmentsLoading } = useContext(ProcessContext);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedEnv, setSelectedEnv] = useState(null);

  const handleRowClick = (env) => {
    setSelectedEnv(env);
    setShowDetailsModal(true);
  };

  if (environmentsLoading) {
    return <div>Loading environments...</div>;
  }

  return (
    <div className="p-3">
      <div className="mb-3">
        <h3>Environments</h3>
        <Alert variant="info" className="mt-2">
          To create a new environment, use the ProcessEditor to create a process of type "create_environment".
        </Alert>
      </div>

      <Table striped bordered hover>
        <thead>
          <tr>
            <th>Name</th>
            <th>Docker Image</th>
            <th>Created By</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {environments.map((env) => (
            <tr
              key={env.id}
              onClick={() => handleRowClick(env)}
              style={{ cursor: 'pointer' }}
            >
              <td>{env.name}</td>
              <td>{env.docker_image}</td>
              <td>{env.process_id ? 'Process' : 'Bootstrap'}</td>
              <td>{env.created_at}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      <EnvironmentDetailsModal
        show={showDetailsModal}
        onHide={() => setShowDetailsModal(false)}
        environment={selectedEnv}
      />
    </div>
  );
}

function EnvironmentDetailsModal({ show, onHide, environment }) {
  if (!environment) return null;

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Environment Details</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="mb-3">
          <strong>ID:</strong> {environment.id}
        </div>
        <div className="mb-3">
          <strong>Name:</strong> {environment.name}
        </div>
        <div className="mb-3">
          <strong>Docker Image:</strong> {environment.docker_image}
        </div>
        <div className="mb-3">
          <strong>Created By:</strong> {environment.process_id ? `Process ${environment.process_id}` : 'Bootstrap'}
        </div>
        <div className="mb-3">
          <strong>Created:</strong> {environment.created_at}
        </div>

        {environment.process_id && (
          <Alert variant="info" className="mt-3">
            To view packages and process types for this environment, view the creating process's parameters.
          </Alert>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

EnvironmentView.title = "Environments";
