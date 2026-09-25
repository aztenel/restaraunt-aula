import { describe, expect, it } from 'vitest';
import { actionsFromTransitions, detailActions, queueCardActions } from './order-actions';

const keys = (actions: Array<{ key: string }>) => actions.map((a) => a.key);

describe('кнопки действий из allowedTransitions', () => {
  it('каждый разрешённый переход — своя кнопка, первая — главная', () => {
    expect(actionsFromTransitions(['accepted'])).toEqual([{ key: 'accept', to: 'accepted', emphasis: 'primary' }]);
    expect(actionsFromTransitions(['cooking'])[0]).toMatchObject({ key: 'startCooking', to: 'cooking' });
    expect(actionsFromTransitions(['ready'])[0]).toMatchObject({ key: 'markReady', to: 'ready' });
    expect(actionsFromTransitions(['delivering'])[0]).toMatchObject({ key: 'dispatch', to: 'delivering' });
    expect(actionsFromTransitions(['completed'])[0]).toMatchObject({ key: 'complete', to: 'completed' });
  });

  it('порядок кнопок не зависит от порядка в ответе; неизвестные статусы игнорируются', () => {
    const actions = actionsFromTransitions(['completed', 'teleported', 'delivering']);
    expect(keys(actions)).toEqual(['dispatch', 'complete']);
    expect(actions.map((a) => a.emphasis)).toEqual(['primary', 'default']);
  });

  it('cancelled — не переход /transition, а отдельное действие отмены', () => {
    const actions = actionsFromTransitions(['cooking', 'cancelled']);
    expect(actions).toEqual([
      { key: 'startCooking', to: 'cooking', emphasis: 'primary' },
      { key: 'cancel', to: null, emphasis: 'danger' },
    ]);
    expect(actionsFromTransitions(['cancelled'])).toEqual([{ key: 'cancel', to: null, emphasis: 'danger' }]);
  });

  it('ничего не разрешено (нет права orders.manage) — нет кнопок', () => {
    expect(actionsFromTransitions([])).toEqual([]);
  });

  it('клиент не придумывает переходов: draft/paid/refunded не превращаются в кнопки', () => {
    expect(actionsFromTransitions(['draft', 'awaiting_payment', 'paid', 'refunded'])).toEqual([]);
  });
});

describe('очередь оператора: флаги сервера', () => {
  const card = (status: string, allowedTransitions: string[], canCancel = false, canReject = false) => ({ status, allowedTransitions, canCancel, canReject });

  it('новый оплаченный заказ: принять или отказать — отказ только по canReject', () => {
    expect(keys(queueCardActions(card('paid', ['accepted'], false, true)))).toEqual(['accept', 'reject']);
    // Сервер не разрешил отказ — кнопки нет, хотя статус paid и переход accepted доступен.
    expect(keys(queueCardActions(card('paid', ['accepted'], false, false)))).toEqual(['accept']);
  });

  it('отмена — только по canCancel', () => {
    expect(keys(queueCardActions(card('accepted', ['cooking', 'cancelled'], true)))).toEqual(['startCooking', 'cancel']);
    expect(keys(queueCardActions(card('accepted', ['cooking', 'cancelled'], false)))).toEqual(['startCooking']);
    expect(keys(queueCardActions(card('awaiting_payment', ['cancelled'], true)))).toEqual(['cancel']);
  });

  it('готовый заказ: доставка — «передать курьеру», самовывоз — «выдан» (как решил сервер)', () => {
    expect(keys(queueCardActions(card('ready', ['delivering'])))).toEqual(['dispatch']);
    expect(keys(queueCardActions(card('ready', ['completed'])))).toEqual(['complete']);
  });

  it('без права orders.manage сервер не присылает ни переходов, ни флагов — кнопок нет', () => {
    expect(queueCardActions(card('paid', []))).toEqual([]);
  });
});

describe('карточка заказа', () => {
  it('флаги сервера canReject/canCancel', () => {
    expect(keys(detailActions({ allowedTransitions: ['accepted'], canReject: true, canCancel: false }))).toEqual(['accept', 'reject']);
    expect(keys(detailActions({ allowedTransitions: ['cooking', 'cancelled'], canReject: false, canCancel: true }))).toEqual([
      'startCooking',
      'cancel',
    ]);
    // Флаг сервера важнее: отмена запрещена, даже если cancelled пришёл в списке.
    expect(keys(detailActions({ allowedTransitions: ['cancelled'], canReject: false, canCancel: false }))).toEqual([]);
  });
});
