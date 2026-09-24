import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { EventBus } from '../../../shared/infrastructure/events/event-bus';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { Money } from '../../../shared/kernel/money';
import { Permission } from '../../../shared/kernel/permissions';
import { translate } from '../../../shared/kernel/translatable';
import { BranchDirectory, BranchInfo } from '../../identity/public';
import { AdminFeed, GuestTemplate, GuestTemplateParams, Notifier } from '../../notifications/public';
import { PaymentPurpose, PaymentsService } from '../../payments/public';
import { Order, OrderTransition } from '../domain/order';
import { cancelReasonLabel, formatEta, formatMoney, orderTypeLabel } from '../domain/order-texts';
import { PromoUsageStatus } from '../domain/promo-code';
import { OrderPaymentsRepository } from '../infrastructure/order-payments.repository';
import { OrderRepository } from '../infrastructure/order.repository';
import { PromoCodeRepository } from '../infrastructure/promo-code.repository';
import { OrderingEvents, OrderStatus } from '../public';
import { RequestCourierDispatch } from './courier-requests';
import { OrderLinks } from './order-links';
import { orderCancelledPayload, orderCompletedPayload, statusChangedPayload } from './order-events';

export interface RecordOptions {
  actor: Actor;
  /** Снимок заказа до действия (для журнала). */
  before?: Record<string, unknown>;
  /** Гостевое уведомление «оплачен» (онлайн-оплата подтверждена позже оформления). */
  notifyGuestPaid?: boolean;
  /** Не уведомлять гостя о промежуточных статусах (отказ: paid → accepted → cancelled). */
  silentGuestStatuses?: readonly OrderStatus[];
}

/**
 * Последствия переходов заказа — в транзакции действия: история статусов, журнал действий (было/стало),
 * событие OrderStatusChanged (+ OrderCompleted / OrderCancelled), уведомления гостю и персоналу,
 * лента админки, промокод, заявка на курьера, отметка получения денег при выполнении.
 * Уведомления создаются записями (доставка — задачами Notifications), приём заказа не блокируют.
 */
@Injectable()
export class OrderTransitionRecorder {
  constructor(
    private readonly orders: OrderRepository,
    private readonly orderPayments: OrderPaymentsRepository,
    private readonly promos: PromoCodeRepository,
    private readonly branches: BranchDirectory,
    private readonly payments: PaymentsService,
    private readonly notifier: Notifier,
    private readonly feed: AdminFeed,
    private readonly audit: AuditLog,
    private readonly events: EventBus,
    private readonly links: OrderLinks,
    private readonly courier: RequestCourierDispatch,
    private readonly clock: Clock,
  ) {}

  async record(order: Order, options: RecordOptions): Promise<OrderTransition[]> {
    const transitions = order.pullTransitions();
    if (transitions.length === 0) return transitions;
    await this.orders.appendHistory(order.id, transitions, options.actor);
    const branch = await this.branches.get(order.branchId);
    const after = order.auditView();
    for (const t of transitions) {
      await this.audit.record({
        action: 'order.status_changed',
        entityType: 'order',
        entityId: order.id,
        branchId: order.branchId,
        before: { ...(options.before ?? after), status: t.from },
        after: { ...after, status: t.to },
        meta: { number: order.snapshot().number, from: t.from, to: t.to, reasonCode: t.reasonCode, reason: t.reason },
        actor: options.actor,
      });
      // Оформление (draft → awaiting_payment) объявляет событие OrderPlaced.
      if (t.from === 'draft') continue;
      await this.events.publish(OrderingEvents.OrderStatusChanged, statusChangedPayload(order, t), {
        aggregateId: order.id,
        branchId: order.branchId,
      });
      await this.sideEffects(order, t, branch, options);
    }
    return transitions;
  }

  private async sideEffects(order: Order, t: OrderTransition, branch: BranchInfo, options: RecordOptions): Promise<void> {
    const s = order.snapshot();
    const silent = options.silentGuestStatuses?.includes(t.to) ?? false;
    const trackingUrl = this.links.tracking(s.publicToken, s.locale);
    switch (t.to) {
      case 'paid': {
        await this.promos.setUsageStatus(order.id, PromoUsageStatus.Reserved, PromoUsageStatus.Used);
        await this.notifier.notifyStaff({
          audience: { branchId: order.branchId, permission: Permission.OrdersManage, includeBranchChannels: true },
          template: 'staff.order_new',
          params: {
            number: s.number,
            type: orderTypeLabel(s.type, 'ru'),
            total: formatMoney(s.totals.total),
            branchName: translate(branch.name, 'ru'),
            adminUrl: this.links.admin(order.id),
          },
          dedupeKey: `order:${order.id}:staff_new`,
          related: { type: 'order', id: order.id },
        });
        await this.feed.push({
          branchId: order.branchId,
          stream: 'orders',
          kind: 'created',
          entityId: order.id,
          title: `Новый заказ ${s.number} · ${orderTypeLabel(s.type, 'ru')} · ${formatMoney(s.totals.total)}`,
          sound: true,
        });
        if (options.notifyGuestPaid && !silent) {
          await this.guest(order, 'order.paid', { number: s.number, total: formatMoney(s.totals.total), trackingUrl });
        }
        return;
      }
      case 'accepted':
        if (!silent) {
          await this.guest(order, 'order.accepted', {
            number: s.number,
            trackingUrl,
            eta: formatEta(s.promisedAt, this.clock.now(), branch.timezone),
          });
        }
        break;
      case 'ready':
        if (s.type === 'pickup' && !silent) {
          await this.guest(order, 'order.ready', {
            number: s.number,
            trackingUrl,
            branchName: translate(branch.name, s.locale),
            branchAddress: translate(branch.address, s.locale),
          });
        }
        if (s.type === 'delivery') await this.courier.execute(order);
        break;
      case 'delivering':
        if (!silent) await this.guest(order, 'order.delivering', { number: s.number, trackingUrl });
        break;
      case 'completed':
        await this.collectOnReceipt(order);
        await this.events.publish(OrderingEvents.OrderCompleted, orderCompletedPayload(order, t.at), {
          aggregateId: order.id,
          branchId: order.branchId,
        });
        if (!silent) await this.guest(order, 'order.completed', { number: s.number });
        break;
      case 'cancelled':
        await this.events.publish(OrderingEvents.OrderCancelled, orderCancelledPayload(order, t.at), {
          aggregateId: order.id,
          branchId: order.branchId,
        });
        if (!silent) {
          await this.guest(order, 'order.cancelled', {
            number: s.number,
            reason: cancelReasonLabel(s.cancellation?.reasonCode ?? 'other', s.locale),
          });
        }
        break;
      case 'refunded': {
        const refunded = Money.sum(
          (await this.orderPayments.refundsForOrder(order.id)).filter((r) => r.status === 'succeeded').map((r) => r.amount),
        );
        if (!silent) await this.guest(order, 'order.refunded', { number: s.number, amount: formatMoney(refunded) });
        break;
      }
      default:
        break;
    }
    await this.feed.push({
      branchId: order.branchId,
      stream: 'orders',
      kind: 'updated',
      entityId: order.id,
      title: `Заказ ${s.number}: ${t.to}`,
      sound: false,
    });
  }

  /** Оплата при получении: деньги получены при выполнении заказа (курьер/касса). */
  private async collectOnReceipt(order: Order): Promise<void> {
    const views = await this.payments.listForReference(PaymentPurpose.Order, order.id);
    for (const p of views) {
      if (p.method === 'on_receipt' && p.status === 'pending') await this.payments.markCollected(p.id);
    }
  }

  private async guest<T extends GuestTemplate>(order: Order, template: T, params: GuestTemplateParams[T]): Promise<void> {
    const s = order.snapshot();
    if (s.customer.phone === 'anonymized') return;
    await this.notifier.notifyGuest({
      recipient: { phone: s.customer.phone, email: s.customer.email, name: s.customer.name },
      template,
      params,
      locale: s.locale,
      dedupeKey: `order:${order.id}:${template.slice('order.'.length)}`,
      related: { type: 'order', id: order.id },
    });
  }
}
