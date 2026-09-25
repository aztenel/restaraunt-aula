import { Injectable } from '@nestjs/common';
import { Config } from '../../../shared/infrastructure/config/config';
import { Locale } from '../../../shared/kernel/translatable';

/** Ссылки модуля: страницы сметы и счёта на витрине, карточка заявки в админке. */
@Injectable()
export class BanquetLinks {
  constructor(private readonly config: Config) {}

  /** Страница сметы для клиента (витрина: /<locale>/banquet/quote/<token>). */
  quote(token: string, locale: Locale): string {
    return `${this.config.app.publicWebUrl}/${locale}/banquet/quote/${encodeURIComponent(token)}`;
  }

  /** Страница счёта: сумма, статус, ссылка на оплату или PDF счёта. */
  invoice(token: string, locale: Locale): string {
    return `${this.config.app.publicWebUrl}/${locale}/banquet/invoice/${encodeURIComponent(token)}`;
  }

  admin(requestId: string): string {
    return `${this.config.app.adminUrl}/banquets/${requestId}`;
  }
}
