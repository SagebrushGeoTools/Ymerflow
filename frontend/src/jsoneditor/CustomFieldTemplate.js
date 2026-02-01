import React from 'react';

export default function CustomFieldTemplate(props) {
  const {
    id,
    classNames,
    style,
    label,
    help,
    required,
    description,
    errors,
    children,
    hidden,
    displayLabel,
  } = props;

  if (hidden) {
    return <div style={{ display: 'none' }}>{children}</div>;
  }

  return (
    <div className={classNames} style={style}>
      {displayLabel && label && (
        <label htmlFor={id} className="control-label">
          {label}
          {required && <span className="required">*</span>}
          {description && (
            <span className="field-description-icon">
              <i className="fa fa-question-circle" aria-label="Help" />
              <span className="field-description-tooltip">{description}</span>
            </span>
          )}
        </label>
      )}
      {children}
      {errors}
      {help}
    </div>
  );
}
