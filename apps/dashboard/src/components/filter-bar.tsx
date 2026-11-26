import type {ReactNode} from 'react';
import './filter-bar.css';

export function FilterFields({children}: {children: ReactNode}) {
  return <div className="filter-fields">{children}</div>;
}
export function FilterBar({
  children,
  label = 'Overview filters',
  variant = 'overview',
  columns,
}: {
  children: ReactNode;
  label?: string;
  variant?: 'overview' | 'scope';
  columns?: 3 | 4 | 6 | 7;
}) {
  return (
    <section className="filter-bar" data-columns={columns ?? (variant === 'scope' ? 3 : 7)} aria-label={label}>
      {children}
    </section>
  );
}
