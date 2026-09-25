import { Injectable } from '@nestjs/common';
import { Actor } from '../../../shared/kernel/actor';
import { BanquetRequest } from '../domain/banquet-request';
import { ActivityRepository } from '../infrastructure/activity.repository';
import { QuoteRecord, QuoteRepository } from '../infrastructure/quote.repository';
import { BanquetSupport } from './banquet-support';

/**
 * Общие шаги воронки, которые выполняются из разных действий:
 * согласование сметы (по ссылке клиентом или менеджером по телефону) и автоматический переход
 * agreed → prepaid, когда оплачено не меньше требуемой предоплаты.
 * Вызывающее действие сохраняет заявку и записывает переходы (BanquetStatusRecorder).
 */
@Injectable()
export class BanquetFunnel {
  constructor(
    private readonly quotes: QuoteRepository,
    private readonly activities: ActivityRepository,
    private readonly support: BanquetSupport,
  ) {}

  async agree(request: BanquetRequest, quote: QuoteRecord, actor: Actor, now: Date): Promise<void> {
    request.transition('agreed', now);
    await this.quotes.markAccepted(quote.id, now);
    // Предоплата по умолчанию — 50% итога согласованной версии (если менеджер не задал сумму сам).
    request.applyDefaultPrepayment(quote.totals.total);
    await this.activities.add({
      requestId: request.id,
      kind: 'quote_accepted',
      data: { quoteId: quote.id, version: quote.version, total: quote.totals.total.toJSON() },
      actor,
      at: now,
    });
  }

  /** agreed → prepaid, если предоплата покрыта. true — переход выполнен. */
  async settlePrepayment(request: BanquetRequest, now: Date): Promise<boolean> {
    if (request.status !== 'agreed') return false;
    const quote = await this.support.currentQuote(request.id);
    const paid = await this.support.paidNet(request.id);
    if (!request.isPrepaymentCovered(paid, quote?.totals.total ?? null)) return false;
    request.transition('prepaid', now, 'Предоплата получена');
    return true;
  }
}
