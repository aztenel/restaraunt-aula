/**
 * Права в разделе банкетов (как на сервере, modules/banquet/application/access.ts):
 *  - заявка проверяется по её филиалу: глобальные роли (банкетный менеджер, финансы, собственник) — везде,
 *    управляющий филиалом — только просмотр своего филиала; выезд без филиала — только глобальные права;
 *  - документы (договор, акт, ЭСФ) — banquets.invoice или banquets.manage;
 *  - возврат оплаты — payments.refund;
 *  - справочник компаний — просмотр banquets.view/invoice, правка banquets.manage/invoice (где-либо);
 *  - шаблоны договоров — правка banquets.manage.
 * Это только UX (скрыть недоступное): окончательную проверку делает сервер.
 */
import { useMemo } from 'react';
import { Permission } from '@aula/api-client';
import { useAuth } from '@/shared/auth/AuthProvider';
import { can, canSomewhere, type PermissionSnapshot } from '@/shared/auth/permissions';

export interface RequestAbilities {
  view: boolean;
  manage: boolean;
  invoice: boolean;
  documents: boolean;
  refund: boolean;
}

export interface SectionAbilities {
  /** Новая заявка из админки. */
  create: boolean;
  invoices: boolean;
  companiesView: boolean;
  companiesEdit: boolean;
  templatesView: boolean;
  templatesEdit: boolean;
}

export function requestAbilities(snapshot: PermissionSnapshot | null | undefined, branchId: string | null): RequestAbilities {
  const manage = can(snapshot, Permission.BanquetsManage, branchId);
  const invoice = can(snapshot, Permission.BanquetsInvoice, branchId);
  return {
    view: can(snapshot, Permission.BanquetsView, branchId),
    manage,
    invoice,
    documents: manage || invoice,
    refund: can(snapshot, Permission.PaymentsRefund, branchId),
  };
}

export function sectionAbilities(snapshot: PermissionSnapshot | null | undefined): SectionAbilities {
  const view = canSomewhere(snapshot, Permission.BanquetsView);
  const manage = canSomewhere(snapshot, Permission.BanquetsManage);
  const invoice = canSomewhere(snapshot, Permission.BanquetsInvoice);
  return {
    create: manage,
    invoices: view,
    companiesView: view || invoice,
    companiesEdit: manage || invoice,
    templatesView: view,
    templatesEdit: manage,
  };
}

export function useRequestAbilities(branchId: string | null | undefined): RequestAbilities {
  const { me } = useAuth();
  return useMemo(() => requestAbilities(me, branchId ?? null), [me, branchId]);
}

export function useSectionAbilities(): SectionAbilities {
  const { me } = useAuth();
  return useMemo(() => sectionAbilities(me), [me]);
}
