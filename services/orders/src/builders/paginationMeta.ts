/** Propiedades HTTP en camelCase, según la convención del README de bases. */
export interface PaginationMeta {
  currentPage: number;
  perPage: number;
  total: number;
  lastPage: number;
}

export function buildPaginationMeta(page: number, perPage: number, total: number): PaginationMeta {
  return {
    currentPage: page,
    perPage,
    total,
    lastPage: Math.max(1, Math.ceil(total / perPage)),
  };
}
