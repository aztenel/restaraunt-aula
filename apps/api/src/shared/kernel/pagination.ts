export interface PageRequest {
  page: number;
  perPage: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export const MAX_PER_PAGE = 200;

export function pageRequest(page?: number, perPage?: number): PageRequest {
  const p = Number.isInteger(page) && (page as number) > 0 ? (page as number) : 1;
  const pp = Number.isInteger(perPage) && (perPage as number) > 0 ? Math.min(perPage as number, MAX_PER_PAGE) : 50;
  return { page: p, perPage: pp };
}

export function offsetOf(req: PageRequest): number {
  return (req.page - 1) * req.perPage;
}

export function pageOf<T>(items: T[], total: number, req: PageRequest): Page<T> {
  return { items, total, page: req.page, perPage: req.perPage };
}
