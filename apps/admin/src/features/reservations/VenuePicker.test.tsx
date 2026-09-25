// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from 'antd';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/shared/i18n';
import type { AdminAvailability, AdminVenueSlot } from './types';
import { VenuePicker } from './VenuePicker';

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

const slot = (patch: Partial<AdminVenueSlot>): AdminVenueSlot => ({
  venueId: 'v1',
  hallId: 'h1',
  hallName: { ru: 'Основной зал' },
  code: 'T1',
  name: { ru: 'Стол 1' },
  typeCode: 'table',
  typeName: { ru: 'Стол' },
  capacityMin: 2,
  capacityMax: 4,
  belowMinimum: false,
  deposit: null,
  start: '2026-10-25T14:00:00.000Z',
  end: '2026-10-25T16:00:00.000Z',
  blockedUntil: '2026-10-25T16:15:00.000Z',
  durationMinutes: 120,
  rules: { durationMinutes: 120, holdMinutes: 30, cancellationDeadlineHours: 24, requiresManualConfirmation: false, cleanupMinutes: 15, slotStepMinutes: 15, bookableOnline: true },
  bookableOnline: true,
  position: { x: 0, y: 0, w: 10, h: 10, rotation: 0, shape: 'rect' },
  ...patch,
});

const base: AdminAvailability = {
  branchId: 'b1',
  date: '2026-10-25',
  time: '19:00',
  guests: 4,
  durationMinutes: null,
  available: true,
  reason: null,
  venues: [],
  alternatives: [],
};

describe('выбор места по свободным местам сервера', () => {
  it('свободные места по залам: «только по телефону», до какого времени, уборка', () => {
    const onChange = vi.fn();
    wrap(<VenuePicker availability={{ ...base, venues: [slot({}), slot({ venueId: 'v2', code: 'Y1', name: { ru: 'Юрта' }, bookableOnline: false })] }} tz="Asia/Almaty" onChange={onChange} />);
    expect(screen.getByText('Основной зал')).toBeTruthy();
    expect(screen.getByText('Только по телефону')).toBeTruthy();
    expect(screen.getAllByText(/до 21:00/).length).toBe(2);
    fireEvent.click(screen.getByText('Юрта · Y1'));
    expect(onChange).toHaveBeenCalledWith('v2');
  });

  it('мест нет: причина от сервера и ближайшее свободное время подставляется в форму', () => {
    const onPickTime = vi.fn();
    wrap(
      <VenuePicker
        availability={{ ...base, available: false, reason: 'occupied', alternatives: [{ date: '2026-10-25', time: '20:30', start: '2026-10-25T15:30:00.000Z', venueIds: ['v1', 'v2'] }] }}
        tz="Asia/Almaty"
        onPickTime={onPickTime}
      />,
    );
    expect(screen.getByText('Все подходящие места заняты на это время')).toBeTruthy();
    fireEvent.click(screen.getByText(/20:30/));
    expect(onPickTime).toHaveBeenCalledWith('20:30');
  });
});
