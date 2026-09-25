// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BranchMenuItem } from '@aula/api-client';
import type * as CatalogModule from '@/shared/api/catalog';
import { i18n } from '@/shared/i18n';
import { skuToSave } from './sku';
import { SkuModal } from './SkuModal';

const api = { setSku: vi.fn(), setPrice: vi.fn(), item: vi.fn() };

vi.mock('@/shared/api/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof CatalogModule>();
  return {
    ...actual,
    branchMenuApi: {
      ...actual.branchMenuApi,
      setSku: (...args: unknown[]) => api.setSku(...args),
      setPrice: (...args: unknown[]) => api.setPrice(...args),
      item: (...args: unknown[]) => api.item(...args),
    },
  };
});

beforeAll(async () => {
  configure({ asyncUtilTimeout: 5000 });
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
  // jsdom не поддерживает getComputedStyle(elt, pseudoElt) — antd меряет полосу прокрутки так.
  const getComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = ((elt: Element) => getComputedStyle(elt)) as typeof window.getComputedStyle;
  await i18n.changeLanguage('ru');
});

afterEach(() => {
  cleanup();
  Object.values(api).forEach((fn) => fn.mockReset());
});

const item = {
  branchId: 'gl',
  dishId: 'd1',
  dishName: { ru: 'Плов' },
  price: { amount: 250_000, currency: 'KZT' },
  sku: 'GL-PLV',
  effectiveSku: 'GL-PLV',
} as unknown as BranchMenuItem;

describe('код POS филиала', { timeout: 30_000 }, () => {
  it('поле → значение запроса: пробелы убираются, пусто — сброс', () => {
    expect(skuToSave('  GL-1 ')).toBe('GL-1');
    expect(skuToSave('   ')).toBeNull();
    expect(skuToSave(null)).toBeNull();
  });

  it('сохраняет только код POS (PUT .../sku) — цена не читается и не отправляется', async () => {
    api.setSku.mockResolvedValue({ ...item, sku: null });
    const onClose = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={new QueryClient()}>
          <App>
            <SkuModal item={item} onClose={onClose} />
          </App>
        </QueryClientProvider>
      </I18nextProvider>,
    );
    const input = await screen.findByDisplayValue('GL-PLV');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }));
    await waitFor(() => expect(api.setSku).toHaveBeenCalledWith('gl', 'd1', null));
    expect(api.setPrice).not.toHaveBeenCalled();
    expect(api.item).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
