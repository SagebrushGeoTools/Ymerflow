import React from 'react';
import { Card, Form } from 'react-bootstrap';

export default function MinioStorageForm({ value, onChange }) {
  return (
    <>
      <Card className="mb-3 bg-light">
        <Card.Body>
          <Card.Title as="h6">How do I get this?</Card.Title>
          <Card.Text as="div" className="text-muted small mb-0">
            MinIO's root user already has full admin access, but handing its password to
            Nagelfluh directly isn't great practice — create a dedicated admin user instead.
            Adjust the endpoint and root credentials below to match your own MinIO deployment
            (drop <code>--insecure</code> if it has a trusted certificate):
            <pre className="mb-1 mt-2">{`mc --insecure alias set myminio https://localhost:9000 minioadmin minioadmin
mc --insecure admin user add myminio myadminuser myadminpass123
mc --insecure admin policy attach myminio consoleAdmin --user myadminuser`}</pre>
            <code>myadminuser</code> / <code>myadminpass123</code> aren't printed by anything —
            you choose them yourself in the <code>admin user add</code> command above. Enter
            those same two values as the Admin Access Key / Admin Secret Key below.
          </Card.Text>
        </Card.Body>
      </Card>
      <Form.Group className="mb-3">
        <Form.Label>Admin Access Key</Form.Label>
        <Form.Control
          value={value.admin_access_key || ''}
          onChange={e => onChange({ ...value, admin_access_key: e.target.value })}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label>Admin Secret Key</Form.Label>
        <Form.Control
          type="password"
          value={value.admin_secret_key || ''}
          onChange={e => onChange({ ...value, admin_secret_key: e.target.value })}
        />
      </Form.Group>
    </>
  );
}
