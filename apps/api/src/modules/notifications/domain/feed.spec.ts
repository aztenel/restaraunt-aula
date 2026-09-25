import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Actor } from '../../../shared/kernel/actor';
import { Permission } from '../../../shared/kernel/permissions';
import {
  actorFromFeedClaims,
  canSeeFeedEvent,
  decodeFeedTicket,
  encodeFeedTicket,
  feedClaimsFor,
  normalizeFeedEvent,
  visibleStreams,
} from './feed';

const staff = (global: Permission[], byBranch: Record<string, Permission[]> = {}) =>
  new Actor({ kind: 'staff', userId: 'u1', name: 'Оператор', globalPermissions: global, branchPermissions: byBranch });

const operatorB1 = staff([], { b1: [Permission.OrdersView, Permission.OrdersManage, Permission.ReservationsView] });
const banquetManager = staff([Permission.BanquetsView, Permission.ReservationsView]);
const sysadmin = staff([Permission.SystemJobs, Permission.IntegrationsManage]);
const owner = staff([Permission.OrdersView, Permission.ReservationsView, Permission.BanquetsView, Permission.SystemJobs]);

describe('admin feed filtering', () => {
  it('stream is visible only with its view permission in the event branch', () => {
    expect(canSeeFeedEvent(operatorB1, { stream: 'orders', branchId: 'b1' })).toBe(true);
    expect(canSeeFeedEvent(operatorB1, { stream: 'orders', branchId: 'b2' })).toBe(false);
    expect(canSeeFeedEvent(operatorB1, { stream: 'reservations', branchId: 'b1' })).toBe(true);
    expect(canSeeFeedEvent(operatorB1, { stream: 'banquets', branchId: 'b1' })).toBe(false);
    expect(canSeeFeedEvent(operatorB1, { stream: 'system', branchId: null })).toBe(false);
  });

  it('events without a branch require a global permission', () => {
    expect(canSeeFeedEvent(operatorB1, { stream: 'orders', branchId: null })).toBe(false);
    expect(canSeeFeedEvent(banquetManager, { stream: 'banquets', branchId: null })).toBe(true);
    expect(canSeeFeedEvent(banquetManager, { stream: 'banquets', branchId: 'b2' })).toBe(true);
    expect(canSeeFeedEvent(banquetManager, { stream: 'orders', branchId: 'b1' })).toBe(false);
    expect(canSeeFeedEvent(sysadmin, { stream: 'system', branchId: null })).toBe(true);
    expect(canSeeFeedEvent(sysadmin, { stream: 'orders', branchId: 'b1' })).toBe(false);
    expect(canSeeFeedEvent(owner, { stream: 'orders', branchId: 'b9' })).toBe(true);
    expect(canSeeFeedEvent(owner, { stream: 'unknown' as never, branchId: null })).toBe(false);
  });

  it('lists visible streams', () => {
    expect(visibleStreams(operatorB1)).toEqual(['orders', 'reservations']);
    expect(visibleStreams(sysadmin)).toEqual(['system']);
    expect(visibleStreams(owner)).toEqual(['orders', 'reservations', 'banquets', 'system']);
  });

  it('normalizes events: sound for new items by default, trimmed title, validated stream', () => {
    expect(normalizeFeedEvent({ branchId: 'b1', stream: 'orders', kind: 'created', entityId: ' o1 ', title: ' Новый заказ ' })).toEqual({
      branchId: 'b1',
      stream: 'orders',
      kind: 'created',
      entityId: 'o1',
      entityType: 'order',
      title: 'Новый заказ',
      sound: true,
    });
    expect(normalizeFeedEvent({ branchId: null, stream: 'orders', kind: 'updated', entityId: 'o1', title: 'x' }).sound).toBe(false);
    // Тип сущности: явный или по потоку; у системных событий без типа — null; неизвестный — ошибка.
    expect(normalizeFeedEvent({ branchId: null, stream: 'orders', kind: 'updated', entityId: 'd1', entityType: 'dish', title: 'x' }).entityType).toBe('dish');
    expect(normalizeFeedEvent({ branchId: null, stream: 'banquets', kind: 'updated', entityId: 'b1', title: 'x' }).entityType).toBe('banquet_request');
    expect(normalizeFeedEvent({ branchId: null, stream: 'system', kind: 'created', entityId: 'j1', title: 'x' }).entityType).toBeNull();
    expect(() => normalizeFeedEvent({ branchId: null, stream: 'orders', kind: 'created', entityId: 'o1', entityType: 'x' as never, title: 'x' })).toThrow();
    expect(() => normalizeFeedEvent({ branchId: null, stream: 'x' as never, kind: 'created', entityId: 'o1', title: 'x' })).toThrow();
    expect(() => normalizeFeedEvent({ branchId: null, stream: 'orders', kind: 'created', entityId: ' ', title: 'x' })).toThrow();
  });
});

describe('feed ticket', () => {
  const key = 'secret';
  const sign = (payload: string) => createHmac('sha256', key).update(payload).digest('hex');
  const verify = (payload: string, sig: string) => sign(payload) === sig;

  it('carries only feed permissions and restores an equivalent actor', () => {
    const actor = staff([Permission.SystemJobs, Permission.UsersManage], { b1: [Permission.OrdersView, Permission.MenuPrices] });
    const claims = feedClaimsFor(actor, 2000);
    expect(claims.global).toEqual([Permission.SystemJobs]);
    expect(claims.byBranch).toEqual({ b1: [Permission.OrdersView] });
    const ticket = encodeFeedTicket(claims, sign);
    const decoded = decodeFeedTicket(ticket, verify, 1000)!;
    expect(decoded).toEqual(claims);
    const restored = actorFromFeedClaims(decoded);
    expect(restored.can(Permission.OrdersView, 'b1')).toBe(true);
    expect(restored.can(Permission.OrdersView, 'b2')).toBe(false);
    expect(restored.can(Permission.UsersManage)).toBe(false);
  });

  it('rejects expired, tampered and malformed tickets', () => {
    const ticket = encodeFeedTicket(feedClaimsFor(owner, 2000), sign);
    expect(decodeFeedTicket(ticket, verify, 2001)).toBeNull();
    const [v, payload, sig] = ticket.split('.');
    const forged = Buffer.from(JSON.stringify({ u: 'u2', n: '', e: 9999, g: 'obrs', b: {} })).toString('base64url');
    expect(decodeFeedTicket(`${v}.${forged}.${sig}`, verify, 1000)).toBeNull();
    expect(decodeFeedTicket(`${v}.${payload}.${sig}x`, verify, 1000)).toBeNull();
    expect(decodeFeedTicket('garbage', verify, 1000)).toBeNull();
    expect(decodeFeedTicket('', verify, 1000)).toBeNull();
  });
});
