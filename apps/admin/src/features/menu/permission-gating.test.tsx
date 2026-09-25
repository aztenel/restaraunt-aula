// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { App } from 'antd';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { BranchMenuItem, Dish, ModifierGroup } from '@aula/api-client';
import { i18n } from '@/shared/i18n';
import { PriceCell } from './branch-menu/PriceCell';
import { DishPhotos } from './dishes/DishPhotos';
import { ModifierGroupsField } from './dishes/ModifierGroupsField';

beforeAll(async () => {
  // antd (адаптивные компоненты) ожидает matchMedia, которого нет в jsdom.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  await i18n.changeLanguage('ru');
});

afterEach(cleanup);

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <App>{children}</App>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

const item: BranchMenuItem = {
  branchId: 'gl',
  dishId: 'd1',
  dishSlug: 'plov',
  dishName: { ru: 'Плов' },
  categoryId: 'c1',
  dishIsActive: true,
  photo: null,
  price: { amount: 250000, currency: 'KZT' },
  availability: 'available',
  displayAvailability: 'available',
  stoppedUntil: null,
  stopReason: null,
  stopSource: null,
  stoppedAt: null,
  sku: null,
  effectiveSku: 'PLV',
  updatedBy: null,
  updatedAt: '2026-09-25T08:00:00.000Z',
};

const photo = (id: string, sortOrder: number) => ({
  id,
  url: `https://cdn/${id}-600.webp`,
  width: 600,
  height: 400,
  sortOrder,
  variants: [{ width: 600, height: 400, url: `https://cdn/${id}-600.webp` }],
});

const dish = { id: 'd1', photos: [photo('p1', 10), photo('p2', 20)] } as unknown as Dish;

const group: ModifierGroup = {
  id: 'g1',
  code: 'portion',
  name: { ru: 'Порция' },
  description: {},
  minSelect: 1,
  maxSelect: 1,
  isRequired: true,
  sortOrder: 0,
  isActive: true,
  options: [],
  dishCount: 1,
  createdAt: '',
  updatedAt: '',
};

describe('действия скрыты без права (menu.prices / menu.content)', () => {
  it('цена в меню филиала: правка только при menu.prices в филиале', () => {
    wrap(<PriceCell item={item} canEdit={false} />);
    expect(screen.getByText(/2\s*500/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Изменить цену' })).toBeNull();
    cleanup();
    wrap(<PriceCell item={item} canEdit />);
    expect(screen.getByRole('button', { name: 'Изменить цену' })).toBeTruthy();
  });

  it('фото блюда: загрузка, порядок и удаление — только при menu.content', () => {
    wrap(<DishPhotos dish={dish} canEdit={false} onChange={() => undefined} />);
    expect(screen.getByText('Обложка')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
    expect(screen.queryByText('Нажмите или перетащите фото (можно несколько)')).toBeNull();
    cleanup();
    wrap(<DishPhotos dish={dish} canEdit onChange={() => undefined} />);
    expect(screen.getAllByRole('button', { name: 'Удалить' })).toHaveLength(2);
    expect(screen.getByText('Нажмите или перетащите фото (можно несколько)')).toBeTruthy();
    // Первое фото нельзя сдвинуть выше, последнее — ниже.
    const up = screen.getAllByRole('button', { name: 'Выше' });
    expect((up[0] as HTMLButtonElement).disabled).toBe(true);
    expect((up[1] as HTMLButtonElement).disabled).toBe(false);
  });

  it('группы модификаторов блюда: без права — только список', () => {
    wrap(<ModifierGroupsField value={['g1']} groups={[group]} disabled />);
    expect(screen.getByText('Порция')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Открепить' })).toBeNull();
    cleanup();
    wrap(<ModifierGroupsField value={['g1']} groups={[group]} onChange={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Открепить' })).toBeTruthy();
  });
});
