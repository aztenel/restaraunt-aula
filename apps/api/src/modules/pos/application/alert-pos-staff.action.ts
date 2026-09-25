import { Injectable } from '@nestjs/common';
import { Permission } from '../../../shared/kernel/permissions';
import { AdminFeed, AdminFeedStream, Notifier } from '../../notifications/public';

export interface PosStaffAlert {
  branchId: string;
  /** Заголовок: «Заказ GL-2026-000123 не передан в POS». */
  title: string;
  /** Что случилось и что делать. */
  details: string;
  /** Ключ дедупликации уведомления (повтор события не рассылает второе оповещение). */
  dedupeKey: string;
  /** Элемент ленты админки: заказ (очередь заказов) или системное событие филиала. */
  feed: { stream: Extract<AdminFeedStream, 'orders' | 'system'>; entityId: string };
  related?: { type: string; id: string };
  /** Кому в филиале: по умолчанию тем, кто ведёт заказы (orders.manage). */
  permission?: Permission;
}

/**
 * Оповещение персонала о проблеме с POS: WhatsApp/Telegram сотрудникам филиала с нужным правом
 * (по умолчанию orders.manage) и каналам точки + элемент ленты админки со звуком. Вызывается в транзакции
 * вызывающего действия: уведомление ставится в очередь, лента публикуется после коммита.
 */
@Injectable()
export class AlertPosStaff {
  constructor(
    private readonly notifier: Notifier,
    private readonly feed: AdminFeed,
  ) {}

  async execute(alert: PosStaffAlert): Promise<void> {
    await this.notifier.notifyStaff({
      audience: { branchId: alert.branchId, permission: alert.permission ?? Permission.OrdersManage, includeBranchChannels: true },
      template: 'staff.system_alert',
      params: { title: alert.title, details: alert.details },
      dedupeKey: alert.dedupeKey,
      related: alert.related,
    });
    await this.feed.push({
      branchId: alert.branchId,
      stream: alert.feed.stream,
      kind: 'updated',
      entityId: alert.feed.entityId,
      // Поток заказов — ссылка на заказ; системное событие POS — на филиал (entityId = id филиала).
      entityType: alert.feed.stream === 'orders' ? 'order' : 'branch',
      title: alert.title,
      sound: true,
    });
  }
}
