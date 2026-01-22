import React from 'react';
import { getDefaultRegistry } from '@rjsf/core';
import DatasetSelector from './DatasetSelector';

export default function CustomStringField(props) {
  const { schema } = props;

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

  // Otherwise, use the default StringField
  const { fields } = getDefaultRegistry();
  const DefaultStringField = fields.StringField;
  return <DefaultStringField {...props} />;
}
