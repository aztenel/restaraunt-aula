'use client';

import { useEffect } from 'react';

/** Прокрутить горизонтальную ленту разделов так, чтобы активный раздел был виден (телефон). */
export function ScrollActiveChip({ listId }: { listId: string }) {
  useEffect(() => {
    const list = document.getElementById(listId);
    const active = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !active) return;
    const left = active.offsetLeft - list.clientWidth / 2 + active.clientWidth / 2;
    list.scrollLeft = Math.max(0, left);
  }, [listId]);
  return null;
}
