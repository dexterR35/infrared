import type {ComponentType, ReactNode, HTMLAttributes} from 'react';
import './card.css';

export function Card({
  title,
  description,
  icon: Icon,
  actions,
  children,
  footer,
  padding = 'normal',
  className = '',
  ...props
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ComponentType<{size?: number}>;
  actions?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  padding?: 'normal' | 'none';
} & Omit<HTMLAttributes<HTMLElement>, 'title'>) {
  return (
    <section
      {...props}
      className={`ui-card ${className}`}
      aria-label={props['aria-label'] ?? (typeof title === 'string' ? title : undefined)}
    >
      {(title || actions) && (
        <header className="ui-card-header">
          <div>
            {Icon && <Icon size={18} />}
            <div>
              {title && <h2>{title}</h2>}
              {description && <p>{description}</p>}
            </div>
          </div>
          {actions}
        </header>
      )}
      {children && (
        <div className="ui-card-body" data-padding={padding}>
          {children}
        </div>
      )}
      {footer && <footer className="ui-card-footer">{footer}</footer>}
    </section>
  );
}
export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ComponentType<{size?: number}>;
}) {
  return (
    <section className="ui-card" data-card="metric" aria-label={typeof label === 'string' ? label : undefined}>
      <div className="ui-card-body">
        <div className="ui-card-label">
          <span>{label}</span>
          {Icon && (
            <span className="ui-card-icon">
              <Icon size={17} />
            </span>
          )}
        </div>
        <strong className="ui-card-value">{value}</strong>
        {detail && <p className="ui-card-detail">{detail}</p>}
      </div>
    </section>
  );
}
export function CardGrid({children, columns}: {children: ReactNode; columns?: 2 | 3 | 4}) {
  return (
    <div className="ui-card-grid" data-columns={columns}>
      {children}
    </div>
  );
}
