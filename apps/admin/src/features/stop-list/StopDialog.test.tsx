// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from 'antd';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BranchMenuItem } from '@aula/api-client';
import { i18n } from '@/shared/i18n';
import { StopDialog } from './StopDialog';

beforeAll(async () => {
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
  // jsdom не поддерживает псевдоэлементы в getComputedStyle (замер полосы прокрутки у Modal).
  const getComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = (element: Element) => getComputedStyle(element);
  await i18n.changeLanguage('ru');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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
  effectiveSku: null,
  updatedBy: null,
  updatedAt: '2026-09-25T08:00:00.000Z',
};

function open(onSubmit = vi.fn()) {
  render(
    <I18nextProvider i18n={i18n}>
      <App>
        <StopDialog item={item} onCancel={() => undefined} onSubmit={onSubmit} />
      </App>
    </I18nextProvider>,
  );
  return onSubmit;
}

describe('стоп-лист: окно постановки в стоп', () => {
  it('по умолчанию — до конца дня (считает сервер по часовому поясу филиала)', () => {
    const onSubmit = open();
    expect(screen.getByRole('radio', { name: 'До конца дня' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /В стоп/ }));
    expect(onSubmit).toHaveBeenCalledWith({ until: null, untilEndOfDay: true, reason: null });
  });

  it('быстрая причина и «на 1 час»', () => {
    vi.useFakeTimers({ now: new Date('2026-09-25T09:10:00.000Z'), toFake: ['Date'] });
    const onSubmit = open();
    fireEvent.click(screen.getByRole('radio', { name: 'На 1 час' }));
    fireEvent.click(screen.getByText('Закончилось'));
    fireEvent.click(screen.getByRole('button', { name: /В стоп/ }));
    expect(onSubmit).toHaveBeenCalledWith({ until: '2026-09-25T10:10:00.000Z', reason: 'Закончилось' });
  });

  it('до ручного возврата — без срока; своё время без даты — ошибка, запрос не отправляется', () => {
    const onSubmit = open();
    fireEvent.click(screen.getByRole('radio', { name: 'Своё время' }));
    fireEvent.click(screen.getByRole('button', { name: /В стоп/ }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Выберите дату и время')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'До ручного возврата' }));
    fireEvent.click(screen.getByRole('button', { name: /В стоп/ }));
    expect(onSubmit).toHaveBeenCalledWith({ until: null, reason: null });
  });
});
