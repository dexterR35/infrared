import {useState, type ReactNode, type DetailsHTMLAttributes} from 'react';
import {ChevronDown} from 'lucide-react';
import './collapsible.css';

type CollapsibleProps = {
  title: ReactNode;
  description?: string;
  children: ReactNode;
  className?: string;
  lazy?: boolean;
  defaultOpen?: boolean;
} & Omit<DetailsHTMLAttributes<HTMLDetailsElement>, 'title' | 'children' | 'open' | 'onToggle'>;
export function Collapsible({
  title,
  description,
  children,
  className = '',
  lazy = false,
  defaultOpen = false,
  ...props
}: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      {...props}
      className={`ui-collapsible ${className}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <div>
          <strong>{title}</strong>
          {description && <span>{description}</span>}
        </div>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      {(!lazy || open) && <div className="ui-collapsible-content">{children}</div>}
    </details>
  );
}
