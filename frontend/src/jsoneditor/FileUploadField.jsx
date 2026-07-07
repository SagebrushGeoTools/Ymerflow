import React, { useState, useContext } from 'react';
import { Form, ProgressBar } from 'react-bootstrap';
import { ProcessContext } from '../ProcessContext';
import { uploadFile } from '../datamodel/api';

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

    try {
      const response = await uploadFile(file, (progress) => {
        setUploadProgress(progress);
      }, currentProject);
      onChange(response.url);
      setUploading(false);
      setUploadProgress(100);
    } catch (err) {
      const errorMsg = err.response?.data?.detail || err.message || 'Upload failed';
      setError(errorMsg);
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
