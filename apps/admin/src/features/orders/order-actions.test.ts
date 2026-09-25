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
    expect(queueCardActions({ status: 'paid', allowedTransitions: [] })).toEqual([]);
  });

  it('клиент не придумывает переходов: draft/paid/refunded не превращаются в кнопки', () => {
    expect(actionsFromTransitions(['draft', 'awaiting_payment', 'paid', 'refunded'])).toEqual([]);
  });
});

describe('очередь оператора', () => {
  it('новый оплаченный заказ: принять или отказать', () => {
    expect(keys(queueCardActions({ status: 'paid', allowedTransitions: ['accepted'] }))).toEqual(['accept', 'reject']);
  });

  it('отказ только для оплаченного, не принятого заказа', () => {
    expect(keys(queueCardActions({ status: 'accepted', allowedTransitions: ['cooking', 'cancelled'] }))).toEqual(['startCooking', 'cancel']);
    expect(keys(queueCardActions({ status: 'awaiting_payment', allowedTransitions: ['cancelled'] }))).toEqual(['cancel']);
  });

  it('готовый заказ: доставка — «передать курьеру», самовывоз — «выдан» (как решил сервер)', () => {
    expect(keys(queueCardActions({ status: 'ready', allowedTransitions: ['delivering'] }))).toEqual(['dispatch']);
    expect(keys(queueCardActions({ status: 'ready', allowedTransitions: ['completed'] }))).toEqual(['complete']);
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
