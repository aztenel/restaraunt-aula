import { Actor } from '../../../shared/kernel/actor';
import { Permission } from '../../../shared/kernel/permissions';
import { BanquetRequest } from '../domain/banquet-request';

/**
 * Права на заявку проверяются по её филиалу: банкетные менеджеры и глобальные роли видят все заявки,
 * управляющий филиалом — заявки своего филиала. Выезд без филиала-исполнителя — только глобальные роли.
 */
export function assertCanView(actor: Actor, request: BanquetRequest): void {
  actor.assertCan(Permission.BanquetsView, request.branchId);
}

export function assertCanManage(actor: Actor, request: BanquetRequest): void {
  actor.assertCan(Permission.BanquetsManage, request.branchId);
}

export function assertCanInvoice(actor: Actor, request: BanquetRequest): void {
  actor.assertCan(Permission.BanquetsInvoice, request.branchId);
}

/** Гость с витрины — для журнала и ленты заявки (имя из формы). */
export function guestActor(name: string): Actor {
  return new Actor({ kind: 'guest', userId: null, name: name || 'guest', globalPermissions: [], branchPermissions: {} });
}
