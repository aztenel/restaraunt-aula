/**
 * Человекочитаемые URL витрины (без префикса языка — его добавляет next-intl).
 * Единственное место, где собираются пути: при изменении структуры меняется только здесь.
 */
export const routes = {
  home: () => '/',
  branches: () => '/branches',
  branch: (branchSlug: string) => `/branches/${encodeURIComponent(branchSlug)}`,
  /** Меню выбранного филиала (редирект на /[branchSlug]/menu). */
  menu: () => '/menu',
  branchMenu: (branchSlug: string) => `/${encodeURIComponent(branchSlug)}/menu`,
  category: (branchSlug: string, categorySlug: string) =>
    `/${encodeURIComponent(branchSlug)}/menu/${encodeURIComponent(categorySlug)}`,
  dish: (branchSlug: string, categorySlug: string, dishSlug: string) =>
    `/${encodeURIComponent(branchSlug)}/menu/${encodeURIComponent(categorySlug)}/${encodeURIComponent(dishSlug)}`,
  cart: () => '/cart',
  checkout: () => '/checkout',
  order: (token: string) => `/orders/${encodeURIComponent(token)}`,
  booking: () => '/booking',
  bookingStatus: (token: string) => `/booking/${encodeURIComponent(token)}`,
  banquets: () => '/banquets',
  banquetQuote: (token: string) => `/banquets/quote/${encodeURIComponent(token)}`,
  banquetInvoice: (token: string) => `/banquets/invoice/${encodeURIComponent(token)}`,
  certificates: () => '/certificates',
  certificateOrder: (token: string) => `/certificates/order/${encodeURIComponent(token)}`,
  page: (slug: string) => `/pages/${encodeURIComponent(slug)}`,
  paymentReturn: () => '/payment/return',
} as const;

/** Юридические страницы (контент — GET /api/v1/public/pages/{slug}, модуль Catalog/контент). */
export const LEGAL_PAGES = ['offer', 'privacy', 'personal-data', 'delivery'] as const;
export type LegalPageSlug = (typeof LEGAL_PAGES)[number];

/**
 * Первый сегмент пути, который НЕ является slug филиала (статические разделы витрины).
 * Нужен переключателю филиала: /greenline/menu/... → /garden-view/menu/...
 */
export const RESERVED_FIRST_SEGMENTS = new Set([
  'branches',
  'menu',
  'cart',
  'checkout',
  'orders',
  'booking',
  'banquets',
  'certificates',
  'pages',
  'payment',
]);

/** Путь страницы меню с другим филиалом, если текущая страница — меню филиала; иначе null. */
export function switchBranchInPath(pathname: string, nextBranchSlug: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  const [first, second, ...rest] = segments;
  if (!first || RESERVED_FIRST_SEGMENTS.has(first) || second !== 'menu') return null;
  return `/${[encodeURIComponent(nextBranchSlug), 'menu', ...rest].join('/')}`;
}
