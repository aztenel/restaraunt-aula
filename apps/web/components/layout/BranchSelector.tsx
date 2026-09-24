'use client';

import { useTranslations } from 'next-intl';
import { useId, useTransition } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { MapPinIcon, ChevronDownIcon } from '@/components/ui/icons';
import { writeBranchCookie } from '@/lib/branch-cookie';
import { useCart } from '@/lib/cart';
import { switchBranchInPath } from '@/lib/routes';
import type { BranchOption } from './types';

/**
 * Переключатель филиала: цены и наличие блюд задаются по филиалу. Выбор хранится в cookie;
 * на странице меню филиала переход на то же место в меню другого филиала.
 * Нативный <select> — лучший вариант для телефонов и экранных чтецов.
 */
export function BranchSelector({ branches, selectedSlug }: { branches: BranchOption[]; selectedSlug: string | null }) {
  const t = useTranslations('Header');
  const router = useRouter();
  const pathname = usePathname();
  const cart = useCart();
  const [pending, startTransition] = useTransition();
  const id = useId();

  if (branches.length === 0) return null;

  const onChange = (slug: string) => {
    const branch = branches.find((b) => b.slug === slug);
    if (!branch) return;
    writeBranchCookie(branch.slug);
    cart.setBranch(branch.id);
    const target = switchBranchInPath(pathname, branch.slug);
    startTransition(() => {
      if (target) router.push(target);
      else router.refresh();
    });
  };

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {t('branch')}
      </label>
      <MapPinIcon size={18} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-earth-500" />
      <select
        id={id}
        value={selectedSlug ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        title={t('branchHint')}
        className="h-11 max-w-[9.5rem] appearance-none truncate rounded-full border border-earth-200 bg-cream-50 py-0 pl-8 pr-8 text-sm font-semibold text-earth-800 hover:border-earth-300 disabled:opacity-60 sm:max-w-[14rem]"
      >
        {selectedSlug === null ? (
          <option value="" disabled>
            {t('chooseBranch')}
          </option>
        ) : null}
        {branches.map((branch) => (
          <option key={branch.id} value={branch.slug}>
            {branch.name}
          </option>
        ))}
      </select>
      <ChevronDownIcon size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-earth-500" />
    </div>
  );
}
