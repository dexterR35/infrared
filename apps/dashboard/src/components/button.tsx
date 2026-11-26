import {forwardRef, type ButtonHTMLAttributes} from 'react';
import './button.css';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'secondary' | 'primary' | 'text' | 'icon' | 'plain';
  busy?: boolean;
};
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {variant = 'secondary', busy = false, className = '', disabled, children, ...props},
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      className={`ui-button ${className}`}
      data-variant={variant}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
    >
      {children}
    </button>
  );
});
