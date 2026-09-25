/**
 * Права раздела «Сертификаты» — зеркало проверок сервера (UX: скрыть недоступное):
 *  - certificates.view хотя бы в одном филиале — поиск, карточка, продукты (сертификаты действуют во всей сети);
 *  - certificates.redeem — погашение в конкретном филиале; проверка кода — redeem или view;
 *  - certificates.manage (глобально) — продукты, блокировка, продление, переотправка;
 *  - выпуск по счёту и ссылка на PDF — глобально certificates.manage или payments.manual;
 *  - отчёт по сети — глобально certificates.view или reports.consolidated.
 */
import { useMemo } from 'react';
import { Permission } from '@aula/api-client';
import { useCan } from '@/shared/auth/useCan';

export function useCertificateAbilities() {
  const { can, canSomewhere, branchesWith } = useCan();
  return useMemo(() => {
    const view = canSomewhere(Permission.CertificatesView);
    const redeemSomewhere = canSomewhere(Permission.CertificatesRedeem);
    const manage = can(Permission.CertificatesManage);
    const sellByInvoice = manage || can(Permission.PaymentsManual);
    return {
      view,
      manage,
      check: view || redeemSomewhere,
      redeemSomewhere,
      redeemBranches: branchesWith(Permission.CertificatesRedeem),
      canRedeemIn: (branchId: string | null) => Boolean(branchId) && can(Permission.CertificatesRedeem, branchId),
      products: view || manage,
      issue: sellByInvoice,
      pdf: sellByInvoice,
      report: can(Permission.CertificatesView) || can(Permission.ReportsConsolidated),
    };
  }, [can, canSomewhere, branchesWith]);
}

export { formatLocalDate } from '@/shared/lib/local-date';
