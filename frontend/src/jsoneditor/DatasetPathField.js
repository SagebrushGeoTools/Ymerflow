import React from 'react';
import DatasetColumnCombobox from './DatasetColumnCombobox';

export default function DatasetPathField({ formData, onChange }) {
  return (
    <DatasetColumnCombobox
      value={formData || ''}
      onChange={onChange}
      mode="dataset"
    />
  );
}
