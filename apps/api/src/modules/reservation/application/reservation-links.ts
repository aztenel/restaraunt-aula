import { Injectable } from '@nestjs/common';
import { Config } from '../../../shared/infrastructure/config/config';
import { Locale } from '../../../shared/kernel/translatable';

/** Ссылки для гостя и персонала: страница брони на витрине (по публичному токену) и карточка в админке. */
@Injectable()
export class ReservationLinks {
  constructor(private readonly config: Config) {}

  /** Страница брони гостя (витрина: /<locale>/reservations/<token>): статус, оплата депозита, отмена. */
  manage(publicToken: string | null, locale: Locale): string {
    if (!publicToken) return this.config.app.publicWebUrl;
    return `${this.config.app.publicWebUrl}/${locale}/reservations/${encodeURIComponent(publicToken)}`;
  }

  /** Оплата депозита: та же страница брони — ссылка провайдера создаётся асинхронно и показывается там. */
  payment(publicToken: string | null, locale: Locale): string {
    return `${this.manage(publicToken, locale)}?pay=1`;
  }

  admin(reservationId: string): string {
    return `${this.config.app.adminUrl}/reservations/${reservationId}`;
  }
}
