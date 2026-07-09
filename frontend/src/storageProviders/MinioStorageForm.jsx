import React from 'react';
import { Form } from 'react-bootstrap';

export default function MinioStorageForm({ value, onChange, hasExisting }) {
  return (
    <>
      <Form.Group className="mb-3">
        <Form.Label>Admin Access Key</Form.Label>
        <Form.Control
          placeholder={hasExisting ? '(currently set — enter to replace)' : ''}
          value={value.admin_access_key || ''}
          onChange={e => onChange({ ...value, admin_access_key: e.target.value })}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label>Admin Secret Key</Form.Label>
        <Form.Control
          type="password"
          placeholder={hasExisting ? '(currently set — enter to replace)' : ''}
          value={value.admin_secret_key || ''}
          onChange={e => onChange({ ...value, admin_secret_key: e.target.value })}
        />
      </Form.Group>
    </>
  );
}
