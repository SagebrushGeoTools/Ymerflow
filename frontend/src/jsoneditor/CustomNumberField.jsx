import React from 'react';
import { getDefaultRegistry } from '@rjsf/core';
import EPSGSelector from './EPSGSelector';

export default function CustomNumberField(props) {
  const { schema } = props;

  if (schema.format === 'x-epsg') {
    const { fields } = getDefaultRegistry();
    const DefaultNumberField = fields.NumberField;

    const customProps = {
      ...props,
      uiSchema: {
        ...props.uiSchema,
        'ui:widget': (widgetProps) => (
          <EPSGSelector
            id={widgetProps.id}
            value={widgetProps.value}
            onChange={widgetProps.onChange}
            required={widgetProps.required}
          />
        )
      }
    };

    return <DefaultNumberField {...customProps} />;
  }

  const { fields } = getDefaultRegistry();
  const DefaultNumberField = fields.NumberField;
  return <DefaultNumberField {...props} />;
}
