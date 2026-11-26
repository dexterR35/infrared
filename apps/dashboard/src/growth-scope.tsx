// Portfolio scope filters are used on always-loaded screens, so they live apart from the
// lazily loaded growth dashboards.
import {FilterFields} from './components/filter-bar.js';
import {FormField} from './components/form-field.js';

export type GrowthScope = {site_id?: string; market: string; product: string; brand: string};
export function ScopeFilters({
  pages,
  sites,
  value,
  onChange,
}: {
  pages: any[];
  sites: any[];
  value: GrowthScope;
  onChange: (v: GrowthScope) => void;
}) {
  const choices = {
    market: [
      ...new Set(pages.map((p) => p.market ?? sites.find((s) => s.id === p.site_id)?.market ?? 'unknown')),
    ].sort(),
    product: [...new Set(pages.map((p) => p.product))].sort(),
    brand: [...new Set(sites.map((s) => s.brand ?? 'default'))].sort(),
  };
  return (
    <FilterFields>
      {(['market', 'product', 'brand'] as const).map((k) => (
        <FormField
          key={k}
          category="select"
          label={k[0].toUpperCase() + k.slice(1)}
          aria-label={`Portfolio ${k}`}
          value={value[k]}
          onChange={(e) => onChange({...value, [k]: e.target.value})}
        >
          <option value="">All {k === 'product' ? 'products' : k === 'brand' ? 'brands' : 'markets'}</option>
          {choices[k].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </FormField>
      ))}
    </FilterFields>
  );
}
export function scopePages(pages: any[], sites: any[], scope: GrowthScope) {
  return pages.filter(
    (p) =>
      (!scope.site_id || p.site_id === scope.site_id) &&
      (!scope.market || (p.market ?? sites.find((s) => s.id === p.site_id)?.market ?? 'unknown') === scope.market) &&
      (!scope.product || p.product === scope.product) &&
      (!scope.brand || (sites.find((s) => s.id === p.site_id)?.brand ?? 'default') === scope.brand),
  );
}
