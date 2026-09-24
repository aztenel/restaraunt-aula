import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Logo } from '@/components/brand/Logo';
import { routes } from '@/lib/routes';
import { BranchSelector } from './BranchSelector';
import { CartButton } from './CartButton';
import { LanguageSwitcher } from './LanguageSwitcher';
import type { BranchOption } from './types';

const DESKTOP_LINKS = [
  { key: 'menu', href: routes.menu() },
  { key: 'booking', href: routes.booking() },
  { key: 'banquets', href: routes.banquets() },
  { key: 'certificates', href: routes.certificates() },
  { key: 'branches', href: routes.branches() },
] as const;

export async function Header({ branches, selectedSlug }: { branches: BranchOption[]; selectedSlug: string | null }) {
  const t = await getTranslations('Header');
  const nav = await getTranslations('Nav');
  return (
    <header className="sticky top-0 z-40 border-b border-earth-100/80 bg-cream-100/95 backdrop-blur supports-[backdrop-filter]:bg-cream-100/85">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-3 sm:px-6">
        <Link href={routes.home()} aria-label={t('homeAria')} className="shrink-0 rounded-xl">
          <Logo className="[&>span:last-child]:hidden min-[380px]:[&>span:last-child]:inline" />
        </Link>
        <nav aria-label={nav('mainNavigation')} className="ml-4 hidden md:block">
          <ul className="flex items-center gap-1">
            {DESKTOP_LINKS.map((link) => (
              <li key={link.key}>
                <Link
                  href={link.href}
                  className="inline-flex h-11 items-center rounded-full px-3 text-sm font-semibold text-earth-700 hover:bg-earth-50 hover:text-earth-900"
                >
                  {nav(link.key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <BranchSelector branches={branches} selectedSlug={selectedSlug} />
          <LanguageSwitcher />
          <CartButton />
        </div>
      </div>
    </header>
  );
}
