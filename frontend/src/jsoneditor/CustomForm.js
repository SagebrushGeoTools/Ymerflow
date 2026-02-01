import React from 'react';
import Form from '@rjsf/core';
import CustomStringField from './CustomStringField';
import ButtonTemplates from './CustomButtonTemplates';
import CustomFieldTemplate from './CustomFieldTemplate';

export default function CustomForm(props) {
  const customFields = {
    StringField: CustomStringField
  };

  const customTemplates = {
    ButtonTemplates: ButtonTemplates,
    FieldTemplate: CustomFieldTemplate
  };

  return <Form {...props} fields={customFields} templates={customTemplates} />;
}
