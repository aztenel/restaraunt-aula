import { describe, expect, it } from 'vitest';
import { InvalidStateTransitionError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { AccountingExport, accountingTotals, buildRetailSales, counterpartiesOf, exportFileName } from './accounting-export';

const now = new Date('2026-10-01T10:00:00Z');

function newExport(format: 'onec_xml' | 'xlsx' = 'onec_xml') {
  return AccountingExport.request({
    id: 'e1',
    format,
    periodFrom: '2026-09-01',
    periodTo: '2026-09-30',
    branchId: null,
    pushRequested: true,
    requestedBy: null,
    requestedAt: now,
  });
}

const file = { key: 'k', name: 'n.xml', contentType: 'application/xml', sizeBytes: 10 };
const totals = accountingTotals({ retailSales: [], certificateSales: [], invoices: [], acts: [] });

describe('AccountingExport state machine', () => {
  it('ready XML with enabled integration queues a push; push can be retried after failure', () => {
    const e = newExport();
    e.markReady(file, totals, now, true);
    expect(e.status).toBe('ready');
    expect(e.pushStatus).toBe('pending');
    e.markPushFailed('HTTP 500');
    expect(e.snapshot().pushError).toBe('HTTP 500');
    e.requestPush();
    expect(e.pushStatus).toBe('pending');
    e.markPushed(now);
    expect(e.snapshot().pushedAt).toEqual(now);
  });

  it('xlsx or disabled integration does not push', () => {
    const xlsx = newExport('xlsx');
    xlsx.markReady(file, totals, now, true);
    expect(xlsx.pushStatus).toBe('not_required');
    expect(() => xlsx.requestPush()).toThrowError(expect.objectContaining({ code: 'accounting_export.push_not_available' }));
    const xml = newExport();
    xml.markReady(file, totals, now, false);
    expect(xml.pushStatus).toBe('not_required');
  });

  it('forbids invalid transitions', () => {
    const e = newExport();
    e.markFailed('boom', now);
    expect(() => e.markReady(file, totals, now, false)).toThrow(InvalidStateTransitionError);
    expect(() => newExport().markPushed(now)).toThrow(InvalidStateTransitionError);
  });
});

describe('buildRetailSales', () => {
  const branches = new Map([['b1', { branchId: 'b1', code: 'GL', name: 'GreenLine' }]]);

  it('aggregates lines, discounts, delivery and payments by method per day and branch', () => {
    const docs = buildRetailSales({
      branches,
      orders: [
        {
          orderId: 'o1',
          branchId: 'b1',
          completedDate: '2026-09-10',
          paymentMethod: 'online',
          subtotal: Money.of(600_000),
          discount: Money.of(60_000),
          deliveryFee: Money.of(50_000),
          total: Money.of(590_000),
        },
        {
          orderId: 'o2',
          branchId: 'b1',
          completedDate: '2026-09-10',
          paymentMethod: 'on_receipt',
          subtotal: Money.of(300_000),
          discount: Money.zero(),
          deliveryFee: Money.zero(),
          total: Money.of(300_000),
        },
      ],
      items: [
        { orderId: 'o1', dishId: 'd1', name: { ru: 'Плов' }, quantity: 2, lineTotal: Money.of(400_000) },
        { orderId: 'o1', dishId: 'd2', name: { ru: 'Чай' }, quantity: 1, lineTotal: Money.of(200_000) },
        { orderId: 'o2', dishId: 'd1', name: { ru: 'Плов' }, quantity: 1, lineTotal: Money.of(300_000) },
      ],
      payments: [
        { orderId: 'o1', method: 'gift_certificate', amount: Money.of(100_000) },
        { orderId: 'o1', method: 'online', amount: Money.of(490_000) },
      ],
      refunds: [{ branchId: 'b1', date: '2026-09-11', amount: Money.of(20_000) }],
    });
    expect(docs).toHaveLength(2);
    const day = docs[0]!;
    expect(day.orders).toBe(2);
    expect(day.total.amount).toBe(890_000);
    expect(day.discounts.amount).toBe(60_000);
    expect(day.deliveryFees.amount).toBe(50_000);
    expect(day.lines.map((l) => [l.dishId, l.quantity, l.amount.amount])).toEqual([
      ['d1', 3, 700_000],
      ['d2', 1, 200_000],
    ]);
    // Остаток заказа o2 без платежей относится к оплате при получении.
    expect(day.payments.map((p) => [p.method, p.amount.amount])).toEqual([
      ['online', 490_000],
      ['on_receipt', 300_000],
      ['gift_certificate', 100_000],
    ]);
    expect(docs[1]).toMatchObject({ date: '2026-09-11', orders: 0 });
    expect(docs[1]!.refunds.amount).toBe(20_000);
  });

  it('counterparties are unique by BIN; file name reflects format and scope', () => {
    const cp = { name: 'ТОО «Ромашка»', bin: '123456789012' };
    const invoice = {
      id: 'i1',
      number: 'GL-2026-000001',
      date: '2026-09-01',
      requestId: 'r1',
      branch: null,
      payerType: 'company' as const,
      counterparty: cp,
      amount: Money.of(1),
      paidTotal: Money.zero(),
      dueDate: null,
    };
    const act = { id: 'a1', number: 'A', date: '2026-09-02', requestId: 'r1', branch: null, counterparty: cp, amount: Money.of(1), vatAmount: Money.zero() };
    expect(counterpartiesOf([invoice], [act])).toEqual([cp]);
    expect(exportFileName('onec_xml', '2026-09-01', '2026-09-30', 'GL')).toBe('aula_accounting_GL_2026-09-01_2026-09-30.xml');
    expect(exportFileName('xlsx', '2026-09-01', '2026-09-30', null)).toBe('aula_accounting_2026-09-01_2026-09-30.xlsx');
  });
});
