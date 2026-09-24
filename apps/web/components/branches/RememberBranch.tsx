'use client';

import { useEffect } from 'react';
import { useRouter } from '@/i18n/navigation';
import { readBranchCookie, writeBranchCookie } from '@/lib/branch-cookie';
import { useCart } from '@/lib/cart';

/**
 * Гость открыл страницу/меню конкретного филиала — запоминаем его как выбранный
 * (cookie + филиал корзины), чтобы шапка и раздел «Меню» вели в этот филиал.
 */
export function RememberBranch({ branchId, slug }: { branchId: string; slug: string }) {
  const router = useRouter();
  const { setBranch } = useCart();
  useEffect(() => {
    setBranch(branchId);
    if (readBranchCookie() !== slug) {
      writeBranchCookie(slug);
      router.refresh();
    }
  }, [branchId, slug, setBranch, router]);
  return null;
}
