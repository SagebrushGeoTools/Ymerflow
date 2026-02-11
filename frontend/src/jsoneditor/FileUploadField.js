import React, { useState, useContext } from 'react';
import { Form, ProgressBar } from 'react-bootstrap';
import { ProcessContext } from '../ProcessContext';
import { API } from '../datamodel/api';

export default function FileUploadField({ value, onChange, id, required }) {
  const { currentProject } = useContext(ProcessContext);
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
          let errorMsg = 'Upload failed';
          try {
            const errorData = JSON.parse(xhr.responseText);
            errorMsg = errorData.detail || errorMsg;
          } catch (e) {
            // Use default error message if response isn't JSON
          }
          setError(errorMsg);
          setUploading(false);
        }
      });

      xhr.addEventListener('error', () => {
        setError('Upload failed');
        setUploading(false);
      });

      // Build URL with project_id parameter
      const uploadUrl = new URL(`${API}/upload`);
      if (currentProject) {
        uploadUrl.searchParams.append('project_id', currentProject);
      }

      xhr.open('POST', uploadUrl.toString());

      // Add authentication header
      const token = localStorage.getItem('auth_token');
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

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
