import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/** Навигация с учётом языка: Link/redirect/usePathname работают с путями без префикса языка. */
export const { Link, redirect, permanentRedirect, usePathname, useRouter, getPathname } = createNavigation(routing);
