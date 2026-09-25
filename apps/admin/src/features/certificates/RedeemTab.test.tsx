// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/shared/i18n';
import { RedeemTab } from './RedeemTab';
import type { CertificateBalance } from './types';

const BRANCH = 'branch-gl';
const api = vi.hoisted(() => ({ check: vi.fn(), redeem: vi.fn() }));

vi.mock('./api', () => ({ certificateKeys: { all: ['certificates'] }, certificatesApi: api }));
vi.mock('./abilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./abilities')>()),
  useCertificateAbilities: () => ({
    view: true,
    manage: false,
    check: true,
    redeemSomewhere: true,
    redeemBranches: [BRANCH],
    canRedeemIn: (id: string | null) => id === BRANCH,
    products: true,
    issue: false,
    pdf: false,
    report: false,
  }),
}));
vi.mock('@/shared/branch/BranchProvider', () => ({
  useBranch: () => ({ selectedBranchId: BRANCH, setSelection: () => undefined, branchName: () => 'GreenLine', branches: [], loading: false }),
}));

const money = (amount: number) => ({ amount, currency: 'KZT' as const });
function balance(patch: Partial<CertificateBalance>): CertificateBalance {
  return {
    id: 'c1',
    maskedCode: '****-****-JKMN',
    kind: 'amount',
    status: 'active',
    nominal: money(1_000_000),
    balance: money(400_000),
    expiresAt: '2027-09-26T19:00:00.000Z',
    validUntil: '2027-09-26',
    setDescription: null,
    ...patch,
  };
}

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

beforeEach(() => {
  api.check.mockReset();
  api.redeem.mockReset();
});

afterEach(cleanup);

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <App>
          <RedeemTab />
        </App>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

async function checkCode(code: string) {
  fireEvent.change(screen.getByLabelText(i18n.t('certificates.redeem.codeLabel')), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: new RegExp(i18n.t('certificates.redeem.check')) }));
  await waitFor(() => expect(api.check).toHaveBeenCalledWith('ABCD-EFGH-JKMN'));
}

describe('экран погашения на точке', () => {
  it('сертификат на сумму: поле суммы и кнопка «Всю сумму»', async () => {
    api.check.mockResolvedValue(balance({ kind: 'amount' }));
    renderTab();
    await checkCode('abcd efgh jkmn');
    await screen.findByText('****-****-JKMN');
    expect(screen.getByText(i18n.t('certificates.redeem.fullAmount'))).toBeTruthy();
    expect(screen.getByRole('button', { name: i18n.t('certificates.redeem.submitAmount') })).toBeTruthy();
    expect(screen.queryByText(i18n.t('certificates.redeem.setFull'))).toBeNull();
  });

  it('сертификат на набор: без суммы, погашается целиком', async () => {
    api.check.mockResolvedValue(balance({ kind: 'set', balance: money(1_000_000), setDescription: 'Плов на 4 персоны' }));
    renderTab();
    await checkCode('ABCD-EFGH-JKMN');
    await screen.findByText(i18n.t('certificates.redeem.setFull'));
    expect(screen.getByText('Плов на 4 персоны')).toBeTruthy();
    expect(screen.queryByText(i18n.t('certificates.redeem.fullAmount'))).toBeNull();
    expect(screen.getByRole('button', { name: i18n.t('certificates.redeem.submitSet') })).toBeTruthy();
  });

  it('заблокированный сертификат — понятная причина, без формы списания', async () => {
    api.check.mockResolvedValue(balance({ status: 'blocked' }));
    renderTab();
    await checkCode('ABCD-EFGH-JKMN');
    await screen.findByText(i18n.t('certificates.redeem.blocker.blocked'));
    expect(screen.queryByRole('button', { name: i18n.t('certificates.redeem.submitAmount') })).toBeNull();
  });

  it('неполный код не проверяется', () => {
    renderTab();
    fireEvent.change(screen.getByLabelText(i18n.t('certificates.redeem.codeLabel')), { target: { value: 'ABCD-EF' } });
    const button = screen.getByRole('button', { name: new RegExp(i18n.t('certificates.redeem.check')) }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
