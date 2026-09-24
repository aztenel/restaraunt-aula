/**
 * Выбранный гостем филиал хранится в cookie (slug): цены в меню задаются по филиалу,
 * поэтому раздел «Меню» открывает меню выбранного филиала. Cookie читается на сервере
 * (шапка, редирект /menu) и пишется в браузере (переключатель филиала).
 */
export const BRANCH_COOKIE = 'aula_branch';
export const BRANCH_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function writeBranchCookie(slug: string): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${BRANCH_COOKIE}=${encodeURIComponent(slug)}; Path=/; Max-Age=${BRANCH_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

export function readBranchCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find((part) => part.startsWith(`${BRANCH_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(BRANCH_COOKIE.length + 1)) : null;
}
