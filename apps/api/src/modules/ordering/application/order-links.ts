import { Injectable } from '@nestjs/common';
import { Config } from '../../../shared/infrastructure/config/config';
import { Locale } from '../../../shared/kernel/translatable';

/** Ссылки для гостя и персонала: страница статуса заказа на витрине и карточка заказа в админке. */
@Injectable()
export class OrderLinks {
  constructor(private readonly config: Config) {}

  /** Страница статуса по публичному токену (витрина: /<locale>/orders/<token>). */
  tracking(publicToken: string, locale: Locale): string {
    return `${this.config.app.publicWebUrl}/${locale}/orders/${encodeURIComponent(publicToken)}`;
  }

  admin(orderId: string): string {
    return `${this.config.app.adminUrl}/orders/${orderId}`;
  }
}
