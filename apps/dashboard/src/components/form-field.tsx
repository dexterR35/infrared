import {
  useId,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from 'react';
import './form-field.css';

type Shared = {label: ReactNode; hint?: ReactNode; error?: string; optional?: boolean; hideLabel?: boolean};
type FieldProps = Shared &
  (
    | ({category?: 'input'} & InputHTMLAttributes<HTMLInputElement>)
    | ({category: 'select'; children: ReactNode} & SelectHTMLAttributes<HTMLSelectElement>)
    | ({category: 'textarea'} & TextareaHTMLAttributes<HTMLTextAreaElement>)
  );

/** Native attributes stay on the control; labels and feedback are always connected. */
export function FormField({label, hint, error, optional, hideLabel = false, ...props}: FieldProps) {
  const generatedId = useId(),
    id = props.id ?? generatedId;
  const describedBy =
    [props['aria-describedby'], hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined;
  const shared = {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : props['aria-invalid'],
    'data-autofocus': props.autoFocus || undefined,
    autoFocus: props.autoFocus,
    className: `form-field-control ${props.className ?? ''}`,
  };
  let control;
  if (props.category === 'select') {
    const {category: _, ...attributes} = props;
    control = <select {...attributes} {...shared} />;
  } else if (props.category === 'textarea') {
    const {category: _, ...attributes} = props;
    control = <textarea {...attributes} {...shared} />;
  } else {
    const {category: _, ...attributes} = props;
    control = <input {...attributes} {...shared} />;
  }
  return (
    <div
      className="form-field"
      data-control={
        props.category === 'select' ? 'select' : props.category === 'textarea' ? 'textarea' : (props.type ?? 'text')
      }
      data-label={hideLabel ? 'hidden' : undefined}
    >
      <label htmlFor={id}>
        {label}
        {optional && <span className="form-field-optional">Optional</span>}
      </label>
      {control}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {error && (
        <small className="form-field-error" id={`${id}-error`}>
          {error}
        </small>
      )}
    </div>
  );
}
