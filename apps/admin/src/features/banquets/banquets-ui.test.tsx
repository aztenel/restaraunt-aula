// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from 'antd';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/shared/i18n';
import { SlaTimer } from './common/ui';
import { PipelineBoard } from './pipeline/PipelineBoard';
import { groupByStatus } from './pipeline/pipeline-utils';
import type { BanquetRequestSummary } from './types';

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

const now = Date.parse('2026-10-01T10:40:00.000Z');

function summary(patch: Partial<BanquetRequestSummary>): BanquetRequestSummary {
  return {
    id: 'r1',
    number: 'GL-B-2026-000001',
    status: 'new',
    source: 'web',
    branchId: 'b1',
    branchName: { ru: 'AULA Есиль' },
    isOffsite: false,
    offsiteAddress: null,
    eventDate: '2026-11-14',
    eventTime: '18:00',
    eventType: 'wedding',
    guests: 120,
    budget: { amount: 500_000_000, currency: 'KZT' },
    contact: { customerId: null, name: 'Айгерим', phone: '+77011234567', email: null },
    managerId: 'm1',
    managerName: 'Динара',
    quoteVersion: null,
    quoteTotal: null,
    slaDeadline: '2026-10-01T10:30:00.000Z',
    slaBreached: false,
    firstResponseAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...patch,
  };
}

describe('интерфейс воронки', () => {
  it('таймер SLA: отсчёт и просрочка', () => {
    wrap(
      <>
        <SlaTimer subject={summary({})} now={Date.parse('2026-10-01T10:05:00.000Z')} />
        <SlaTimer subject={summary({ id: 'r2' })} now={now} />
      </>,
    );
    expect(screen.getByText('Ответ через 25:00')).toBeTruthy();
    expect(screen.getByText('Просрочено на 10:00')).toBeTruthy();
  });

  it('доска: карточки по колонкам, красная карточка при нарушении SLA, подсветка новой, свёрнутые отменённые', () => {
    const onOpen = vi.fn();
    const columns = groupByStatus([
      summary({}),
      summary({ id: 'r2', number: 'GL-B-2026-000002', status: 'in_progress', firstResponseAt: '2026-10-01T10:10:00.000Z', isOffsite: true, branchName: null, offsiteAddress: 'Астана' }),
      summary({ id: 'r3', number: 'GL-B-2026-000003', status: 'cancelled' }),
    ]);
    const { container } = wrap(<PipelineBoard columns={columns} now={now} highlighted={new Set(['r1'])} onOpen={onOpen} />);
    expect(screen.getByText('GL-B-2026-000001')).toBeTruthy();
    expect(screen.getByText('GL-B-2026-000002')).toBeTruthy();
    // Отменённые свёрнуты: карточки не видно, есть кнопка раскрытия.
    expect(screen.queryByText('GL-B-2026-000003')).toBeNull();
    expect(container.querySelector('.aula-bq-card--breached')).toBeTruthy();
    expect(container.querySelector('.aula-bq-card--fresh')).toBeTruthy();
    expect(screen.getByText('Выезд')).toBeTruthy();
    fireEvent.click(screen.getByText('GL-B-2026-000001'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
    fireEvent.click(screen.getByRole('button', { name: /Показать отменённые/ }));
    expect(screen.getByText('GL-B-2026-000003')).toBeTruthy();
  });
});
