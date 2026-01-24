import React, { useState, useContext } from 'react';
import { Modal, Button, Form, Table } from 'react-bootstrap';
import { ProcessContext } from '../ProcessContext';
import { useCreateEnvironment } from '../hooks/useQueries';

export default function EnvironmentView() {
  const { environments, environmentsLoading } = useContext(ProcessContext);
  const [showCreateModal, setShowCreateModal] = useState(false);
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
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h3>Environments</h3>
        <Button variant="primary" onClick={() => setShowCreateModal(true)}>
          Create New Environment
        </Button>
      </div>

      <Table striped bordered hover>
        <thead>
          <tr>
            <th>Name</th>
            <th>Docker Image</th>
            <th># Packages</th>
            <th># Process Types</th>
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
              <td>{env.packages?.length || 0}</td>
              <td>{Object.keys(env.process_types || {}).length}</td>
              <td>{env.created_at}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      <CreateEnvironmentModal
        show={showCreateModal}
        onHide={() => setShowCreateModal(false)}
      />

      <EnvironmentDetailsModal
        show={showDetailsModal}
        onHide={() => setShowDetailsModal(false)}
        environment={selectedEnv}
      />
    </div>
  );
}

function CreateEnvironmentModal({ show, onHide }) {
  const [name, setName] = useState('');
  const [dockerImage, setDockerImage] = useState('python:3.11');
  const [packagesText, setPackagesText] = useState('');
  const [processTypesText, setProcessTypesText] = useState('{}');
  const createEnvironmentMutation = useCreateEnvironment();

  const handleSubmit = (e) => {
    e.preventDefault();

    // Parse packages from text (one per line, format: package==version)
    const packages = packagesText
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [name, version] = line.split('==').map(s => s.trim());
        return { name, version: version || 'latest' };
      });

    // Parse process types from JSON
    let processTypes = {};
    try {
      processTypes = JSON.parse(processTypesText);
    } catch (err) {
      alert('Invalid JSON for process types');
      return;
    }

    createEnvironmentMutation.mutate(
      {
        name,
        docker_image: dockerImage,
        packages,
        process_types: processTypes,
        created_at: new Date().toISOString()
      },
      {
        onSuccess: () => {
          alert('Environment created successfully');
          setName('');
          setDockerImage('python:3.11');
          setPackagesText('');
          setProcessTypesText('{}');
          onHide();
        },
        onError: (error) => {
          console.error('Failed to create environment:', error);
          alert('Failed to create environment');
        }
      }
    );
  };

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Create New Environment</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3">
            <Form.Label>Name *</Form.Label>
            <Form.Control
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g., Production Environment"
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Docker Image</Form.Label>
            <Form.Control
              type="text"
              value={dockerImage}
              onChange={(e) => setDockerImage(e.target.value)}
              placeholder="e.g., python:3.11"
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Packages (one per line, format: package==version)</Form.Label>
            <Form.Control
              as="textarea"
              rows={5}
              value={packagesText}
              onChange={(e) => setPackagesText(e.target.value)}
              placeholder="numpy==1.24.0&#10;pandas==2.0.0&#10;scipy==1.10.0"
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Process Types (JSON)</Form.Label>
            <Form.Control
              as="textarea"
              rows={10}
              value={processTypesText}
              onChange={(e) => setProcessTypesText(e.target.value)}
              placeholder='{"process_name": {"schema": {...}}}'
              style={{ fontFamily: 'monospace' }}
            />
          </Form.Group>

          <div className="d-flex justify-content-end gap-2">
            <Button variant="secondary" onClick={onHide}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Create
            </Button>
          </div>
        </Form>
      </Modal.Body>
    </Modal>
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
          <strong>Created:</strong> {environment.created_at}
        </div>

        <div className="mb-3">
          <strong>Packages ({environment.packages?.length || 0}):</strong>
          {environment.packages && environment.packages.length > 0 ? (
            <ul className="mt-2">
              {environment.packages.map((pkg, idx) => (
                <li key={idx}>
                  {pkg.name}=={pkg.version}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-muted mt-2">No packages</div>
          )}
        </div>

        <div className="mb-3">
          <strong>Process Types ({Object.keys(environment.process_types || {}).length}):</strong>
          <pre
            className="mt-2 p-2 bg-light border rounded"
            style={{
              maxHeight: '300px',
              overflow: 'auto',
              fontSize: '0.85rem'
            }}
          >
            {JSON.stringify(environment.process_types, null, 2)}
          </pre>
        </div>
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
