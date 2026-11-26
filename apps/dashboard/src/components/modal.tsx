import {Button} from './button.js';
import {useEffect, useId, useRef, type ReactNode, type KeyboardEvent} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import './modal.css';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  icon?: ReactNode;
  busy?: boolean;
  className?: string;
};

/** Native dialog provides focus containment, inert background and focus restoration. */
export function Modal({open, onClose, title, description, children, icon, busy = false, className = ''}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null),
    titleId = useId(),
    descriptionId = useId();
  const returnFocus = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement),
  );
  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus="true"], [autofocus]')?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
    };
  }, [open]);
  function containFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const controls = [
      ...event.currentTarget.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]'),
    ].filter((element) => !element.matches(':disabled') && element.tabIndex >= 0 && element.getClientRects().length);
    const first = controls[0],
      last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  if (!open) return null;
  return createPortal(
    <dialog
      ref={ref}
      className={`ui-modal ${className}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={busy}
      onKeyDown={containFocus}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const rect = e.currentTarget.getBoundingClientRect();
          if (
            !busy &&
            (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)
          )
            onClose();
        }
      }}
    >
      <header className="ui-modal-header">
        <div className="ui-modal-title">
          {icon && <span className="ui-modal-icon">{icon}</span>}
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
        </div>
        <Button
          variant="icon"
          type="button"
          className="ui-modal-close"
          onClick={onClose}
          disabled={busy}
          aria-label="Close dialog"
        >
          <X size={18} />
        </Button>
      </header>
      {children}
    </dialog>,
    document.body,
  );
}
