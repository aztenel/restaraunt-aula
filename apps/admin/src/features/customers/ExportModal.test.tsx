// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from 'antd';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/shared/i18n';
import { ExportModal } from './ExportModal';

vi.mock('@/shared/branch/BranchProvider', () => ({
  useBranch: () => ({ branchName: (id: string) => `Филиал ${id}`, branches: [], selectedBranchId: null }),
}));

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
  const getComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = (element: Element) => getComputedStyle(element);
  await i18n.changeLanguage('ru');
});

afterEach(cleanup);

function open(effectiveFilter: Parameters<typeof ExportModal>[0]['effectiveFilter']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <App>
          <ExportModal refinements={effectiveFilter} segmentId={null} segmentName={null} effectiveFilter={effectiveFilter} onClose={() => undefined} />
        </App>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: i18n.t('customers.export.submit') }) as HTMLButtonElement;
}

describe('выгрузка гостей: правила цели на экране', () => {
  it('маркетинг по умолчанию: только гости с согласием, условие добавлено автоматически', () => {
    open({ tags: ['regular'] });
    expect(screen.getByText(i18n.t('customers.export.notices.marketing_only_consented'))).toBeTruthy();
    expect(screen.getByText(i18n.t('customers.export.notices.marketing_consent_added'))).toBeTruthy();
    // фактический фильтр выгрузки показывает добавленное условие
    expect(screen.getByText(i18n.t('customers.summary.marketingYes'))).toBeTruthy();
    expect(submitButton().disabled).toBe(false);
  });

  it('маркетинг с условием «без согласия» — выгрузка заблокирована, сервисная доступна', () => {
    open({ marketingConsent: false });
    expect(screen.getByText(i18n.t('customers.export.blocker.marketing_requires_consent'))).toBeTruthy();
    expect(submitButton().disabled).toBe(true);

    fireEvent.click(screen.getByLabelText(i18n.t('customers.export.purposes.service')));
    expect(screen.queryByText(i18n.t('customers.export.blocker.marketing_requires_consent'))).toBeNull();
    expect(screen.getByText(i18n.t('customers.export.notices.service_purpose_logged'))).toBeTruthy();
    expect(screen.getByText(i18n.t('customers.export.notices.service_includes_unconsented'))).toBeTruthy();
    expect(submitButton().disabled).toBe(false);
  });
});
