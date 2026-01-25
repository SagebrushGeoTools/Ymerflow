import React, { useState } from 'react';
import { Form, ProgressBar } from 'react-bootstrap';

const API = "http://localhost:8000";

export default function FileUploadField({ value, onChange, id, required }) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    setUploadProgress(0);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100;
          setUploadProgress(percentComplete);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          const response = JSON.parse(xhr.responseText);
          onChange(response.url);
          setUploading(false);
          setUploadProgress(100);
        } else {
          setError('Upload failed');
          setUploading(false);
        }
      });

      xhr.addEventListener('error', () => {
        setError('Upload failed');
        setUploading(false);
      });

      xhr.open('POST', `${API}/upload`);
      xhr.send(formData);
    } catch (err) {
      setError(err.message || 'Upload failed');
      setUploading(false);
    }
  };

  const getFilenameFromUrl = (url) => {
    if (!url) return null;
    const fileId = url.split('/').pop();
    return fileId;
  };

  return (
    <div>
      <Form.Group>
        <Form.Control
          id={id}
          type="file"
          onChange={handleFileChange}
          disabled={uploading}
          required={required && !value}
        />
      </Form.Group>

      {uploading && (
        <ProgressBar
          now={uploadProgress}
          label={`${Math.round(uploadProgress)}%`}
          className="mt-2"
        />
      )}

      {error && (
        <div className="text-danger mt-2">
          {error}
        </div>
      )}

      {value && !uploading && (
        <div className="mt-2">
          <small className="text-muted">Uploaded file: </small>
          <a href={value} target="_blank" rel="noopener noreferrer" className="ms-1">
            {value}
          </a>
        </div>
      )}
    </div>
  );
}
