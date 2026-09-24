import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/** Навигация с учётом языка: Link/redirect/usePathname работают с путями без префикса языка. */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
