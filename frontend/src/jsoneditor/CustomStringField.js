import React from 'react';
import { getDefaultRegistry } from '@rjsf/core';
import DatasetSelector from './DatasetSelector';
import DatasetPathField from './DatasetPathField';
import ExpressionField from './ExpressionField';
import FileUploadField from './FileUploadField';

export default function CustomStringField(props) {
  const { schema } = props;

  console.log('[CustomStringField] schema:', JSON.stringify(schema).slice(0, 300));

  // Expression field (column path OR computation object).
  // The expression def has type:string so rjsf routes here directly; label is
  // rendered by rjsf's SchemaField/FieldTemplate above us.
  if (schema['x-format'] === 'expression') {
    return (
      <ExpressionField
        schema={{ anyOf: schema._expressionAnyOf || [] }}
        formData={props.formData}
        onChange={props.onChange}
        registry={props.registry}
        fieldPathId={props.fieldPathId}
      />
    );
  }

  // Check if this field should use the DatasetPathField (process-scoped path)
  if (schema['x-format'] === 'datasetPath') {
    return (
      <DatasetPathField
        formData={props.formData}
        onChange={props.onChange}
      />
    );
  }

  // Check if this field should use the DatasetSelector
  if (schema['x-format'] === 'dataset') {
    // Let the default StringField handle the form integration,
    // but we'll override just the widget
    const { fields } = getDefaultRegistry();
    const DefaultStringField = fields.StringField;

    // Create custom uiSchema to use our widget
    const customProps = {
      ...props,
      uiSchema: {
        ...props.uiSchema,
        'ui:widget': (widgetProps) => {
          return (
            <DatasetSelector
              id={widgetProps.id}
              value={widgetProps.value || ''}
              onChange={widgetProps.onChange}
              required={widgetProps.required}
            />
          );
        }
      }
    };

    return <DefaultStringField {...customProps} />;
  }

  // Check if this field should use the FileUploadField
  if (schema['x-format'] === 'upload') {
    const { fields } = getDefaultRegistry();
    const DefaultStringField = fields.StringField;

    // Create custom uiSchema to use our widget
    const customProps = {
      ...props,
      uiSchema: {
        ...props.uiSchema,
        'ui:widget': (widgetProps) => {
          return (
            <FileUploadField
              id={widgetProps.id}
              value={widgetProps.value || ''}
              onChange={widgetProps.onChange}
              required={widgetProps.required}
            />
          );
        }
      }
    };

    return <DefaultStringField {...customProps} />;
  }

  // Otherwise, use the default StringField
  const { fields } = getDefaultRegistry();
  const DefaultStringField = fields.StringField;
  return <DefaultStringField {...props} />;
}
