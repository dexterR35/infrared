import {readQuery, invalidateQueries} from './query-cache.js';
import {DEFAULT_TABLE_PAGE_SIZE, TABLE_PAGE_SIZES} from '../../../packages/contracts/table-pagination.js';
import {Button} from './components/button.js';
import {FormField} from './components/form-field.js';
import './data-table.css';
import {Fragment, useId, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {
  useTable,
  tableFeatures,
  rowPaginationFeature,
  rowSortingFeature,
  createPaginatedRowModel,
  createSortedRowModel,
  sortFns,
  type ColumnDef,
  type PaginationState,
  type SortingState,
  type OnChangeFn,
} from '@tanstack/react-table';
import {
  ChevronDown,
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RefreshCw,
  Search,
} from 'lucide-react';

const features = tableFeatures({
  rowPaginationFeature,
  rowSortingFeature,
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  sortFns,
});
export type TableColumn<T> = {
  id: string;
  label: string;
  value: (row: T) => string | number | null | undefined;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
};
export type PageMeta = {pageIndex: number; pageSize: number; rowCount: number; pageCount: number};
type ServerState = {
  pagination: PaginationState;
  sorting: SortingState;
  rowCount: number;
  onPaginationChange: OnChangeFn<PaginationState>;
  onSortingChange: OnChangeFn<SortingState>;
};
const empty: never[] = [];

export function DataTable<T extends object>({
  name,
  data,
  columns,
  rowId,
  initialSorting = [],
  resetKey = '',
  className = '',
  loading = false,
  error = '',
  onRetry,
  server,
  renderExpanded,
  expandable,
  expandedLabel = 'View details',
}: {
  name: string;
  data: T[];
  columns: TableColumn<T>[];
  rowId: (row: T) => string;
  initialSorting?: SortingState;
  resetKey?: string;
  className?: string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  server?: ServerState;
  renderExpanded?: (row: T) => ReactNode;
  expandable?: (row: T) => boolean;
  expandedLabel?: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set()),
    expansionId = useId();
  const columnCount = columns.length + (renderExpanded ? 1 : 0);
  const [pagination, setPagination] = useState<PaginationState>({pageIndex: 0, pageSize: DEFAULT_TABLE_PAGE_SIZE});
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const defs = useMemo<ColumnDef<typeof features, T, any>[]>(
    () =>
      columns.map((c) => ({
        id: c.id,
        header: c.label,
        accessorFn: c.value,
        enableSorting: c.sortable !== false,
        sortUndefined: 'last',
      })),
    [columns],
  );
  const table = useTable({
    features,
    data,
    columns: defs,
    getRowId: rowId,
    manualPagination: !!server,
    manualSorting: !!server,
    rowCount: server?.rowCount,
    autoResetPageIndex: false,
    enableSortingRemoval: false,
    enableMultiSort: false,
    state: {pagination: server?.pagination ?? pagination, sorting: server?.sorting ?? sorting},
    onPaginationChange: server?.onPaginationChange ?? setPagination,
    onSortingChange:
      server?.onSortingChange ??
      ((update) => {
        setSorting(update);
        setPagination((p) => ({...p, pageIndex: 0}));
      }),
  });
  useEffect(() => {
    setExpanded(new Set());
    if (!server) setPagination((p) => ({...p, pageIndex: 0}));
  }, [resetKey]);
  useEffect(() => {
    if (server) return;
    const last = Math.max(0, Math.ceil(data.length / pagination.pageSize) - 1);
    if (pagination.pageIndex > last) setPagination((p) => ({...p, pageIndex: last}));
  }, [data.length, pagination.pageSize, pagination.pageIndex, !!server]);
  const state = table.state.pagination,
    total = server?.rowCount ?? data.length,
    count = Math.max(1, Math.ceil(total / state.pageSize));
  const start = total ? state.pageIndex * state.pageSize + 1 : 0,
    end = total ? Math.min(total, start + state.pageSize - 1) : 0;
  const pageOptions = [
    ...new Set([
      0,
      count - 1,
      ...Array.from({length: 7}, (_, index) => state.pageIndex - 3 + index).filter(
        (index) => index >= 0 && index < count,
      ),
    ]),
  ].sort((a, b) => a - b);
  const byId = new Map(columns.map((c) => [c.id, c]));
  return (
    <div className="data-table" aria-busy={loading}>
      {error && (
        <div className="table-error" role="alert">
          <span>{error}</span>
          {onRetry && (
            <Button variant="text" onClick={onRetry}>
              <RefreshCw size={13} />
              Retry
            </Button>
          )}
        </div>
      )}
      <div className="table-scroll" tabIndex={0} role="region" aria-label={name + ' table scroll area'}>
        <table className={'page-table ' + className} aria-label={name}>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {renderExpanded && (
                  <th scope="col" className="table-expand-column">
                    <span>More</span>
                  </th>
                )}
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        header.column.getCanSort()
                          ? sorted === 'asc'
                            ? 'ascending'
                            : sorted === 'desc'
                              ? 'descending'
                              : 'none'
                          : undefined
                      }
                    >
                      {header.column.getCanSort() ? (
                        <Button
                          variant="plain"
                          className="table-sort"
                          disabled={loading}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {byId.get(header.column.id)?.label}
                          {sorted === 'asc' ? (
                            <ArrowUp size={12} />
                          ) : sorted === 'desc' ? (
                            <ArrowDown size={12} />
                          ) : (
                            <ChevronsUpDown size={12} />
                          )}
                        </Button>
                      ) : (
                        byId.get(header.column.id)?.label || <span className="sr-only">Actions</span>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {!error &&
              !loading &&
              table.getRowModel().rows.map((row) => {
                const canExpand = !!renderExpanded && (!expandable || expandable(row.original)),
                  isExpanded = canExpand && expanded.has(row.id),
                  detailId = expansionId + '-' + encodeURIComponent(row.id);
                return (
                  <Fragment key={row.id}>
                    <tr data-row-id={row.id} className={isExpanded ? 'table-row-expanded' : undefined}>
                      {renderExpanded && (
                        <td className="table-expand-column">
                          {canExpand && (
                            <Button
                              variant="icon"
                              type="button"
                              className="table-expand-button"
                              aria-label={expandedLabel + ' for ' + String(columns[0]?.value(row.original) ?? row.id)}
                              aria-expanded={isExpanded}
                              aria-controls={isExpanded ? detailId : undefined}
                              onClick={() =>
                                setExpanded((current) => {
                                  const next = new Set(current);
                                  if (next.has(row.id)) next.delete(row.id);
                                  else next.add(row.id);
                                  return next;
                                })
                              }
                            >
                              <ChevronDown size={16} />
                            </Button>
                          )}
                        </td>
                      )}
                      {row.getAllCells().map((cell) => {
                        const col = byId.get(cell.column.id)!;
                        return (
                          <td key={cell.id}>
                            {col.render ? col.render(row.original) : String(col.value(row.original) ?? '-')}
                          </td>
                        );
                      })}
                    </tr>
                    {isExpanded && (
                      <tr className="table-expanded-row">
                        <td colSpan={columnCount}>
                          <div id={detailId} className="table-expanded-content">
                            {renderExpanded?.(row.original)}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            {(loading || error || !total) && (
              <tr>
                <td className="table-empty" colSpan={columnCount}>
                  {loading
                    ? 'Loading data…'
                    : error
                      ? 'Data could not be loaded. Retry to fetch the current results.'
                      : 'No matching records.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="table-pagination">
        <span className="table-range" aria-live="polite">
          {loading
            ? 'Loading…'
            : error
              ? 'Results unavailable'
              : `${start.toLocaleString('en-GB')}–${end.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')}`}
        </span>
        <FormField
          category="select"
          label="Rows"
          aria-label={name + ' rows per page'}
          value={state.pageSize}
          disabled={loading}
          onChange={(e) => {
            const next = {pageIndex: 0, pageSize: Number(e.target.value)};
            if (server) server.onPaginationChange(next);
            else setPagination(next);
          }}
        >
          {TABLE_PAGE_SIZES.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </FormField>
        <FormField
          category="select"
          label="Page"
          aria-label={name + ' page'}
          value={Math.min(state.pageIndex, count - 1)}
          disabled={loading || !!error || !total}
          onChange={(event) => table.setPageIndex(Number(event.target.value))}
        >
          {pageOptions.map((index) => (
            <option key={index} value={index}>
              {index + 1}
            </option>
          ))}
        </FormField>
        <span className="table-page">of {count}</span>
        <div className="table-page-buttons">
          {[
            {label: 'First', icon: ChevronsLeft, action: () => table.firstPage(), enabled: table.getCanPreviousPage()},
            {
              label: 'Previous',
              icon: ChevronLeft,
              action: () => table.previousPage(),
              enabled: table.getCanPreviousPage(),
            },
            {label: 'Next', icon: ChevronRight, action: () => table.nextPage(), enabled: table.getCanNextPage()},
            {
              label: 'Last',
              icon: ChevronsRight,
              action: () => table.setPageIndex(count - 1),
              enabled: table.getCanNextPage(),
            },
          ].map(({label, icon: Icon, action, enabled}) => (
            <Button
              variant="secondary"
              key={label}
              type="button"
              aria-label={name + ' ' + label.toLowerCase() + ' page'}
              title={label + ' page'}
              disabled={loading || !!error || !enabled}
              onClick={action}
            >
              <Icon size={15} />
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Growing database histories use validated server paging, never a truncated local slice. */
export function RemoteTable<T extends object>({
  name,
  endpoint,
  columns,
  rowId,
  defaultSort,
  reloadToken = 0,
}: {
  name: string;
  endpoint: string;
  columns: TableColumn<T>[];
  rowId: (row: T) => string;
  defaultSort: string;
  reloadToken?: number;
}) {
  const [pagination, setPagination] = useState<PaginationState>({pageIndex: 0, pageSize: DEFAULT_TABLE_PAGE_SIZE}),
    [sorting, setSorting] = useState<SortingState>([{id: defaultSort, desc: true}]),
    [input, setInput] = useState(''),
    [search, setSearch] = useState(''),
    [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{key: string; rows: T[]; pagination: PageMeta} | null>(null),
    [failure, setFailure] = useState<{key: string; message: string} | null>(null);
  const snapshot = useRef('');
  useEffect(() => {
    if (input.trim() === search) return;
    const timer = setTimeout(() => {
      snapshot.current = '';
      setSearch(input.trim());
      setPagination((p) => ({...p, pageIndex: 0}));
    }, 250);
    return () => clearTimeout(timer);
  }, [input, search]);
  const query = new URLSearchParams({
      page: String(pagination.pageIndex),
      page_size: String(pagination.pageSize),
      sort: sorting[0]?.id ?? defaultSort,
      direction: sorting[0]?.desc ? 'desc' : 'asc',
      search,
    }).toString(),
    key = endpoint + (endpoint.includes('?') ? '&' : '?') + query;
  const requestKey = key + '|' + reloadToken + '|' + retry;
  useEffect(() => {
    snapshot.current = '';
  }, [reloadToken, retry]);
  useEffect(() => {
    snapshot.current = '';
    setPagination((current) => ({...current, pageIndex: 0}));
  }, [endpoint, defaultSort]);
  useEffect(() => {
    snapshot.current = '';
  }, [endpoint, sorting[0]?.id, sorting[0]?.desc, pagination.pageSize]);
  useEffect(() => {
    let live = true;
    setFailure(null);
    const url = key + (snapshot.current ? '&as_of=' + encodeURIComponent(snapshot.current) : '');
    readQuery<{rows: T[]; pagination: PageMeta; snapshot: string}>(url)
      .then((body) => {
        if (
          !Array.isArray(body.rows) ||
          !body.pagination ||
          !Number.isInteger(body.pagination.rowCount) ||
          body.pagination.rowCount < 0 ||
          !Number.isInteger(body.pagination.pageIndex) ||
          body.pagination.pageIndex < 0 ||
          body.pagination.pageSize !== pagination.pageSize ||
          typeof body.snapshot !== 'string'
        )
          throw Error('INVALID_TABLE_RESPONSE');
        if (!live) return;
        snapshot.current = body.snapshot;
        if (body.pagination.pageIndex !== pagination.pageIndex) {
          setPagination((current) => ({...current, pageIndex: body.pagination.pageIndex}));
          return;
        }
        setResult({key: requestKey, rows: body.rows, pagination: body.pagination});
      })
      .catch((error) => {
        if (live) setFailure({key: requestKey, message: String(error.message).replaceAll('_', ' ').toLowerCase()});
      });
    return () => {
      live = false;
    };
  }, [requestKey]);

  const current = result?.key === requestKey ? result : null,
    error = failure?.key === requestKey ? failure.message : '',
    loading = !current && !error;
  return (
    <>
      <div className="table-search">
        <Search size={14} />
        <FormField
          hideLabel
          label={'Search ' + name}
          type="search"
          aria-label={'Search ' + name}
          placeholder="Search records…"
          value={input}
          maxLength={120}
          onChange={(e) => setInput(e.target.value)}
        />
        <Button
          variant="text"
          aria-label={'Refresh ' + name}
          onClick={() => {
            invalidateQueries();
            snapshot.current = '';
            setPagination((p) => ({...p, pageIndex: 0}));
            setRetry((n) => n + 1);
          }}
        >
          <RefreshCw size={13} />
          Refresh
        </Button>
      </div>
      <DataTable
        name={name}
        data={current?.rows ?? empty}
        columns={columns}
        rowId={rowId}
        loading={loading}
        error={error}
        onRetry={() => {
          invalidateQueries();
          setRetry((n) => n + 1);
        }}
        server={{
          pagination,
          sorting,
          rowCount: current?.pagination.rowCount ?? 0,
          onPaginationChange: setPagination,
          onSortingChange: (update) => {
            setSorting(update);
            setPagination((p) => ({...p, pageIndex: 0}));
          },
        }}
      />
    </>
  );
}
