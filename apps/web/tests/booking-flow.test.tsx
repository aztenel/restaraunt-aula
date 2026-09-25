import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ru from '@/messages/ru.json';
import { BookingFlow } from '@/components/booking/BookingFlow';
import type { Availability, HallMap } from '@/lib/api-types';
import { fail, ok } from './support/api';

const api = vi.hoisted(() => ({ POST: vi.fn(), GET: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const reachGoal = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({ getBrowserApi: () => api }));
vi.mock('@/lib/goals', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/goals')>()), reachGoal }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('branch=garden') }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => router,
}));

const kzt = (amount: number) => ({ amount, currency: 'KZT' as const });
const rules = { holdMinutes: 30, cancellationDeadlineHours: 24, requiresManualConfirmation: false };
const position = { x: 10, y: 10, w: 100, h: 60, shape: 'rect' as const, rotation: 0 };

const branches = [
  { id: 'b1', slug: 'greenline', name: 'AULA GreenLine', address: 'Кенесары, 40', phone: '+77172000001' },
  { id: 'b2', slug: 'garden', name: 'AULA Garden', address: 'Туран, 5', phone: '+77172000002' },
];

const hallMap: HallMap = {
  branchId: 'b2',
  branchSlug: 'garden',
  acceptsReservations: true,
  halls: [
    {
      id: 'h1',
      name: 'Главный зал',
      description: '',
      planWidth: 400,
      planHeight: 300,
      background: null,
      venues: [
        { id: 'v-table', name: 'Стол 5', description: '', typeCode: 'table', typeName: 'Стол', capacityMin: 2, capacityMax: 6, deposit: null, position, bookableOnline: true, photos: [], available: null },
        { id: 'v-vip', name: 'VIP «Байтерек»', description: '', typeCode: 'vip_hall', typeName: 'VIP-зал', capacityMin: 4, capacityMax: 20, deposit: kzt(5_000_000), position, bookableOnline: true, photos: [], available: null },
      ],
    },
  ],
};

function availability(patch: Partial<Availability> = {}): Availability {
  return {
    branchId: 'b2',
    branchSlug: 'garden',
    date: '2030-01-10',
    time: '19:00',
    guests: 4,
    durationMinutes: null,
    available: true,
    reason: null,
    venues: [
      { venueId: 'v-table', hallId: 'h1', hallName: 'Главный зал', name: 'Стол 5', description: '', typeCode: 'table', typeName: 'Стол', capacityMin: 2, capacityMax: 6, deposit: null, start: '2030-01-10T14:00:00Z', end: '2030-01-10T16:00:00Z', durationMinutes: 120, rules, position, photos: [] },
      { venueId: 'v-vip', hallId: 'h1', hallName: 'Главный зал', name: 'VIP «Байтерек»', description: '', typeCode: 'vip_hall', typeName: 'VIP-зал', capacityMin: 4, capacityMax: 20, deposit: kzt(5_000_000), start: '2030-01-10T14:00:00Z', end: '2030-01-10T18:00:00Z', durationMinutes: 240, rules, position, photos: [] },
    ],
    alternatives: [],
    ...patch,
  };
}

function route(url: string) {
  if (url.endsWith('/halls')) return ok(hallMap);
  if (url.endsWith('/reservation-availability')) return ok(availability());
  throw new Error(`unexpected GET ${url}`);
}

function renderFlow() {
  render(
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
      <BookingFlow branches={branches} />
    </NextIntlClientProvider>,
  );
}

async function searchFor(date: string) {
  const dateInput = await screen.findByLabelText('Дата');
  fireEvent.change(dateInput, { target: { value: date } });
  fireEvent.change(screen.getByLabelText('Время'), { target: { value: '19:00' } });
  fireEvent.change(screen.getByLabelText('Гостей'), { target: { value: '4' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Найти свободные места' }));
  });
}

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  api.GET.mockImplementation(async (url: string) => route(url));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('бронь: поиск → выбор → бронь', () => {
  it('ищет свободные места выбранного филиала, бронирует VIP с депозитом и ведёт на оплату', async () => {
    api.POST.mockResolvedValue(ok({ token: 'res_TOKEN1234567890', status: 'awaiting_deposit' }, 201));
    renderFlow();
    await searchFor('2030-01-10');

    const availabilityCall = api.GET.mock.calls.find(([url]) => String(url).endsWith('/reservation-availability'));
    expect(availabilityCall?.[1]).toMatchObject({ params: { path: { branchSlug: 'garden' }, query: { date: '2030-01-10', time: '19:00', guests: 4, locale: 'ru' } } });

    const vip = await screen.findByRole('radio', { name: /VIP «Байтерек»/ });
    expect(vip.textContent).toMatch(/депозит 50\s000\s₸/);
    expect(screen.getByRole('radio', { name: /Стол 5/ }).textContent).toMatch(/без депозита/);
    fireEvent.click(vip);
    expect(vip.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));

    fireEvent.change(await screen.findByLabelText('Имя'), { target: { value: 'Айгерим' } });
    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '+7 701 123 45 67' } });
    fireEvent.change(screen.getByLabelText(/Повод/), { target: { value: 'Юбилей' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /обработку персональных данных/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Забронировать и оплатить депозит 50\s000\s₸/ }));
    });

    expect(api.POST).toHaveBeenCalledTimes(1);
    const [path, { body }] = api.POST.mock.calls[0]!;
    expect(path).toBe('/api/v1/public/reservations');
    expect(body).toMatchObject({
      branchId: 'b2',
      venueId: 'v-vip',
      date: '2030-01-10',
      time: '19:00',
      guests: 4,
      durationMinutes: 240,
      customer: { name: 'Айгерим', phone: '+7 701 123 45 67' },
      occasion: 'Юбилей',
      consent: { personalData: true },
      locale: 'ru',
    });
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(body)).not.toMatch(/deposit|amount/);
    expect(reachGoal).toHaveBeenCalledWith('reservation_created', expect.objectContaining({ branch_id: 'b2', venue_type: 'vip_hall', deposit: true }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/booking/res_TOKEN1234567890', query: { pay: '1' } });
  });

  it('мест нет — причина и альтернативное время, клик по нему повторяет поиск', async () => {
    api.GET.mockImplementation(async (url: string, init: { params: { query: { time?: string } } }) => {
      if (url.endsWith('/halls')) return ok(hallMap);
      if (init.params.query.time === '21:00') return ok(availability({ time: '21:00' }));
      return ok(availability({ available: false, reason: 'occupied', venues: [], alternatives: [{ date: '2030-01-10', time: '21:00', start: '2030-01-10T16:00:00Z', venueIds: ['v-table'] }] }));
    });
    renderFlow();
    await searchFor('2030-01-10');
    expect(await screen.findByText('Все подходящие места на это время заняты.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /21:00/ }));
    });
    expect(await screen.findByRole('radio', { name: /Стол 5/ })).toBeTruthy();
    expect((screen.getByLabelText('Время') as HTMLSelectElement).value).toBe('21:00');
  });

  it('место успели занять — обновляет выдачу и просит выбрать другое', async () => {
    api.POST.mockResolvedValue(fail(409, 'reservation.venue_occupied'));
    renderFlow();
    await searchFor('2030-01-10');
    fireEvent.click(await screen.findByRole('radio', { name: /Стол 5/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    fireEvent.change(await screen.findByLabelText('Имя'), { target: { value: 'Айгерим' } });
    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '+7 701 123 45 67' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /обработку персональных данных/ }));
    const searches = api.GET.mock.calls.filter(([url]) => String(url).endsWith('/reservation-availability')).length;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Забронировать' }));
    });
    expect(await screen.findByText(/Это место только что заняли\. Выберите другое место или время\./)).toBeTruthy();
    await waitFor(() => expect(api.GET.mock.calls.filter(([url]) => String(url).endsWith('/reservation-availability')).length).toBe(searches + 1));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('без согласия и контактов бронь не отправляется', async () => {
    renderFlow();
    await searchFor('2030-01-10');
    fireEvent.click(await screen.findByRole('radio', { name: /Стол 5/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Забронировать' }));
    });
    expect(api.POST).not.toHaveBeenCalled();
    expect(screen.getByText('Проверьте поля, отмеченные красным.')).toBeTruthy();
    expect(screen.getByText(/Без согласия на обработку персональных данных/)).toBeTruthy();
  });
});
