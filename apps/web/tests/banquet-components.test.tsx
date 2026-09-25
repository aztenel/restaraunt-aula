import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ru from '@/messages/ru.json';
import { BanquetRequestForm } from '@/components/banquets/BanquetRequestForm';
import { QuoteAccept } from '@/components/banquets/QuoteAccept';
import { fail, ok } from './support/api';

const api = vi.hoisted(() => ({ POST: vi.fn(), GET: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const reachGoal = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({ getBrowserApi: () => api }));
vi.mock('@/lib/goals', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/goals')>()), reachGoal }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => router,
}));

function withIntl(children: ReactNode) {
  return (
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
      {children}
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('смета: согласование', () => {
  const TOKEN = 'quote_TOKEN_1234567890';

  it('согласует показанную версию после подтверждения и показывает предоплату от сервера', async () => {
    api.POST.mockResolvedValue(ok({ status: 'agreed', version: 3, prepayment: { amount: 75_000_000, currency: 'KZT' } }));
    render(withIntl(<QuoteAccept token={TOKEN} version={3} canAccept accepted={false} />));

    fireEvent.click(screen.getByRole('button', { name: 'Согласовать смету' }));
    expect(screen.getByText(/версия № 3/)).toBeTruthy();
    expect(api.POST).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Да, согласовать' }));
    });

    expect(api.POST).toHaveBeenCalledWith('/api/v1/public/banquets/quotes/{token}/accept', { params: { path: { token: TOKEN } }, body: { version: 3 } });
    expect(screen.getByRole('status').textContent).toMatch(/Смета согласована/);
    expect(screen.getByRole('status').textContent).toMatch(/Предоплата — 750\s000\s₸/);
    expect(router.refresh).toHaveBeenCalled();
  });

  it('менеджер успел отправить новую версию — сообщение и обновление страницы', async () => {
    api.POST.mockResolvedValue(fail(409, 'banquet_quote.outdated', { latestVersion: 4 }));
    render(withIntl(<QuoteAccept token={TOKEN} version={3} canAccept accepted={false} />));
    fireEvent.click(screen.getByRole('button', { name: 'Согласовать смету' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Да, согласовать' }));
    });
    expect(screen.getByRole('alert').textContent).toMatch(/новую версию сметы/);
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('истёкшая смета — просьба связаться с менеджером', async () => {
    api.POST.mockResolvedValue(fail(409, 'banquet_quote.expired'));
    render(withIntl(<QuoteAccept token={TOKEN} version={1} canAccept accepted={false} />));
    fireEvent.click(screen.getByRole('button', { name: 'Согласовать смету' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Да, согласовать' }));
    });
    expect(screen.getByRole('alert').textContent).toMatch(/Срок действия сметы истёк/);
  });

  it('уже согласована или нельзя согласовать — без кнопки', () => {
    render(withIntl(<QuoteAccept token={TOKEN} version={1} canAccept={false} accepted />));
    expect(screen.getByText('Смета согласована')).toBeTruthy();
    cleanup();
    render(withIntl(<QuoteAccept token={TOKEN} version={1} canAccept={false} accepted={false} />));
    expect(screen.queryByRole('button', { name: 'Согласовать смету' })).toBeNull();
    expect(screen.getByText(/нельзя согласовать онлайн/)).toBeTruthy();
  });
});

describe('банкет: форма заявки', () => {
  const eventTypes = [
    { code: 'wedding' as const, label: 'Свадьба' },
    { code: 'kudalyk' as const, label: 'Құдалық' },
  ];
  const branches = [
    { id: 'b1', slug: 'greenline', name: 'AULA GreenLine', address: 'Кенесары, 40' },
    { id: 'b2', slug: 'garden', name: 'AULA Garden', address: 'Туран, 5' },
  ];

  it('отправляет заявку с бюджетом в тиынах и показывает номер и менеджера', async () => {
    api.POST.mockResolvedValue(ok({ number: 'B-2026-0042', status: 'new', managerName: 'Динара', managerPhone: '+77010000000' }, 201));
    render(withIntl(<BanquetRequestForm eventTypes={eventTypes} branches={branches} initialType="kudalyk" />));

    expect((screen.getByLabelText('Мероприятие') as HTMLSelectElement).value).toBe('kudalyk');
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2030-06-01' } });
    fireEvent.change(screen.getByLabelText('Гостей'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Ресторан'), { target: { value: 'b2' } });
    fireEvent.change(screen.getByLabelText(/Бюджет/), { target: { value: '2 500 000,50' } });
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Айгерим' } });
    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '+7 701 123 45 67' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /обработку персональных данных/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));
    });

    expect(api.POST).toHaveBeenCalledWith('/api/v1/public/banquets/requests', {
      body: {
        eventDate: '2030-06-01',
        eventType: 'kudalyk',
        guests: 120,
        branchId: 'b2',
        budget: { amount: 250_000_050, currency: 'KZT' },
        contact: { name: 'Айгерим', phone: '+7 701 123 45 67' },
        consent: { personalData: true },
        locale: 'ru',
      },
    });
    expect(reachGoal).toHaveBeenCalledWith('banquet_request', expect.objectContaining({ event_type: 'kudalyk', guests: 120, offsite: false }));
    expect(screen.getByRole('status').textContent).toMatch(/Заявка № B-2026-0042 принята/);
    expect(screen.getByRole('status').textContent).toMatch(/Динара/);
    expect(screen.getByRole('link', { name: /Позвонить менеджеру/ }).getAttribute('href')).toBe('tel:+77010000000');
  });

  it('выездное обслуживание требует адрес; ошибки показываются у полей', async () => {
    render(withIntl(<BanquetRequestForm eventTypes={eventTypes} branches={branches} />));
    fireEvent.click(screen.getByRole('radio', { name: /Выездное обслуживание/ }));
    fireEvent.change(screen.getByLabelText(/Бюджет/), { target: { value: '12,345' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));
    });
    expect(api.POST).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/Проверьте поля/);
    expect(screen.getByLabelText('Адрес площадки').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Укажите сумму числом, например 500 000')).toBeTruthy();
  });

  it('ошибка сервера по полю — текст у поля', async () => {
    api.POST.mockResolvedValue(fail(400, 'banquet.event_date_too_far'));
    render(withIntl(<BanquetRequestForm eventTypes={eventTypes} branches={branches} initialType="wedding" />));
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2035-06-01' } });
    fireEvent.change(screen.getByLabelText('Гостей'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Айгерим' } });
    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '+7 701 123 45 67' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /обработку персональных данных/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));
    });
    expect(screen.getByLabelText('Дата').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getAllByText('Слишком далёкая дата — свяжитесь с менеджером.').length).toBeGreaterThan(0);
  });
});
