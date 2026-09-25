import { describe, expect, it } from 'vitest';
import { feedEntityPath, feedQueryInvalidations } from './feed-links';

const base = { stream: 'orders' as const, entityId: 'x-1' };

describe('ссылки уведомлений ленты на сущность', () => {
  it('заказ, бронь, банкетная заявка, задача, филиал', () => {
    expect(feedEntityPath({ ...base, entityType: 'order' }, { canStopList: false })).toBe('/orders/x-1');
    expect(feedEntityPath({ ...base, stream: 'reservations', entityType: 'reservation' }, { canStopList: false })).toBe('/reservations?open=x-1');
    expect(feedEntityPath({ ...base, stream: 'banquets', entityType: 'banquet_request' }, { canStopList: false })).toBe('/banquets/x-1');
    expect(feedEntityPath({ ...base, stream: 'system', entityType: 'failed_job' }, { canStopList: false })).toBe('/system');
    expect(feedEntityPath({ ...base, stream: 'system', entityType: 'branch' }, { canStopList: false })).toBe('/branches');
  });

  it('блюдо (стоп-лист): стоп-лист при праве menu.stoplist, иначе меню филиала', () => {
    expect(feedEntityPath({ ...base, entityType: 'dish' }, { canStopList: true })).toBe('/stop-list');
    expect(feedEntityPath({ ...base, entityType: 'dish' }, { canStopList: false })).toBe('/menu/branch');
  });

  it('без типа или неизвестный тип — раздел очереди; id экранируется', () => {
    expect(feedEntityPath({ ...base, stream: 'banquets' }, { canStopList: true })).toBe('/banquets');
    expect(feedEntityPath({ ...base, entityType: 'something_new' }, { canStopList: true })).toBe('/orders');
    expect(feedEntityPath({ ...base, entityType: null }, { canStopList: true })).toBe('/orders');
    expect(feedEntityPath({ ...base, entityId: 'a/b', entityType: 'order' }, { canStopList: true })).toBe('/orders/a%2Fb');
  });
});

describe('обновление запросов по событиям ленты', () => {
  it('стоп-лист блюда обновляет меню филиала, стоп-лист и меню телефонного заказа (без повторов)', () => {
    const dish = { stream: 'orders', kind: 'updated', entityType: 'dish', entityId: 'd1', branchId: 'b1', title: 'x' };
    expect(feedQueryInvalidations([dish, { ...dish, entityId: 'd2' }])).toEqual([
      ['catalog', 'branch-menu', 'b1'],
      ['phone-order', 'menu', 'b1'],
    ]);
    expect(feedQueryInvalidations([{ ...dish, branchId: null }])).toEqual([['catalog', 'branch-menu'], ['phone-order', 'menu']]);
  });

  it('прочие события и мусор — ничего дополнительно', () => {
    expect(feedQueryInvalidations([{ stream: 'orders', kind: 'created', entityType: 'order', entityId: 'o1' }, null, 'x', 42])).toEqual([]);
  });
});
