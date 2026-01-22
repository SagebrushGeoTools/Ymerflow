import React from 'react';
import Form from '@rjsf/core';
import CustomStringField from './CustomStringField';

export default function CustomForm(props) {
  const customFields = {
    StringField: CustomStringField
  };

  return <Form {...props} fields={customFields} />;
}
