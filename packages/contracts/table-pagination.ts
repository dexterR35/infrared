export const DEFAULT_TABLE_PAGE_SIZE = 5;
export const TABLE_PAGE_SIZES = [5, 20, 50] as const;
export type TablePagination = {pageIndex: number; pageSize: number; rowCount: number; pageCount: number};
