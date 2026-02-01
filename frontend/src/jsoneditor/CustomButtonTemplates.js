import React from 'react';
import { TranslatableString, getSubmitButtonOptions } from '@rjsf/utils';

// Base IconButton with FontAwesome
function IconButton({ iconType = 'default', icon, className, ...otherProps }) {
  return (
    <button type='button' className={`btn btn-${iconType} ${className}`} {...otherProps}>
      <i className={`fa fa-${icon}`} />
    </button>
  );
}

export function AddButton({ id, className, onClick, disabled, registry }) {
  const { translateString } = registry;
  return (
    <div className='row'>
      <p className={`col-xs-4 col-sm-2 col-lg-1 col-xs-offset-8 col-sm-offset-10 col-lg-offset-11 text-right ${className}`}>
        <IconButton
          id={id}
          iconType='info'
          icon='plus'
          className='btn-add col-xs-12'
          title={translateString(TranslatableString.AddButton)}
          onClick={onClick}
          disabled={disabled}
        />
      </p>
    </div>
  );
}

export function CopyButton(props) {
  const { registry: { translateString } } = props;
  return <IconButton title={translateString(TranslatableString.CopyButton)} {...props} icon='copy' />;
}

export function MoveDownButton(props) {
  const { registry: { translateString } } = props;
  return <IconButton title={translateString(TranslatableString.MoveDownButton)} {...props} icon='arrow-down' />;
}

export function MoveUpButton(props) {
  const { registry: { translateString } } = props;
  return <IconButton title={translateString(TranslatableString.MoveUpButton)} {...props} icon='arrow-up' />;
}

export function RemoveButton(props) {
  const { registry: { translateString } } = props;
  return <IconButton title={translateString(TranslatableString.RemoveButton)} {...props} iconType='danger' icon='times' />;
}

export function SubmitButton({ uiSchema }) {
  const { submitText, norender, props: submitButtonProps = {} } = getSubmitButtonOptions(uiSchema);

  if (norender) {
    return null;
  }

  return (
    <div>
      <button
        type="submit"
        {...submitButtonProps}
        className={`btn btn-primary ${submitButtonProps.className || ''}`}
      >
        {submitText}
      </button>
    </div>
  );
}

const ButtonTemplates = {
  AddButton,
  CopyButton,
  MoveDownButton,
  MoveUpButton,
  RemoveButton,
  SubmitButton,
};

export default ButtonTemplates;
