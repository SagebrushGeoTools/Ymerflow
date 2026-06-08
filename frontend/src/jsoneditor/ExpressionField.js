import React, { useCallback, useState } from 'react';
import DatasetColumnCombobox from './DatasetColumnCombobox';

export default function ExpressionField(props) {
  const { schema, formData, onChange, registry, fieldPathId } = props;
  const isComputation = typeof formData === 'object' && formData !== null;
  const [mode, setMode] = useState(isComputation ? 'computation' : 'column');

  const computationSchemas = (schema._expressionAnyOf || schema.anyOf || []).filter(s => s.type === 'object');
  const hasComputations = computationSchemas.length > 0;

  // RJSF v6 requires onChange(value, absolutePath) so the Form root knows where to
  // apply the update. Without the path, the Form replaces the entire root formData.
  // DatasetColumnCombobox and the toggle call this single-argument helper.
  const handleDirectChange = useCallback(
    (value) => onChange(value, fieldPathId.path),
    [onChange, fieldPathId],
  );

  const handleToggle = () => {
    if (mode === 'column') {
      setMode('computation');
      // Don't call onChange here — let the user pick a computation first.
      // Calling onChange({}) would send an invalid object for a type:string field
      // through RJSF/gladly and cause the entire plot config to be reset.
    } else {
      setMode('column');
      handleDirectChange('');
    }
  };

  const toggleBtn = hasComputations && (
    <button
      type="button"
      title={mode === 'column' ? 'Switch to computation mode' : 'Switch to column mode'}
      onClick={handleToggle}
      style={{ padding: '2px 6px', flexShrink: 0, fontSize: '13px', cursor: 'pointer' }}
    >
      {mode === 'column' ? 'ƒ' : '⬚'}
    </button>
  );

  if (mode === 'column') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {toggleBtn}
        <div style={{ flex: 1 }}>
          <DatasetColumnCombobox
            value={typeof formData === 'string' ? formData : ''}
            onChange={handleDirectChange}
            mode="column"
          />
        </div>
      </div>
    );
  }

  // Computation mode — render anyOf for object computation schemas.
  // Pass our own fieldPathId (not a freshly created one) so that paths built by
  // inner widgets extend our absolute path and the Form root applies updates at
  // the correct location in the form tree.
  // Pass the raw onChange (not handleDirectChange) so RJSF's internal path
  // mechanism works: inner widgets call onChange(value, absolutePath) which
  // propagates through the SchemaField chain unchanged to the Form root.
  const { SchemaField: DefaultSchemaField } = registry.fields;
  const computationAnyOfSchema = { anyOf: computationSchemas };
  const computationFormData = isComputation ? formData : {};

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
      {toggleBtn}
      <div style={{ flex: 1 }}>
        <DefaultSchemaField
          name=""
          schema={computationAnyOfSchema}
          formData={computationFormData}
          onChange={onChange}
          registry={registry}
          uiSchema={{}}
          errorSchema={{}}
          fieldPathId={fieldPathId}
        />
      </div>
    </div>
  );
}
