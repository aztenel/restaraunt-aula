import { describe, expect, it } from 'vitest';
import { aggregateMessageStatus, Delivery, MAX_ATTEMPTS_PER_CHANNEL, MESSAGE_FSM } from './delivery';
import { guestChannelPlan, planGuestDeliveries, planStaffDeliveries } from './delivery-plan';
import { maskAddress, maskEmail, maskParams, splitSensitiveParams } from './masking';

const WA = { channel: 'whatsapp' as const, address: '+77011234567' };
const SMS = { channel: 'sms' as const, address: '+77011234567' };

describe('Delivery', () => {
  it('retries a channel on temporary errors, then falls back to the next channel', () => {
    const d = Delivery.start([WA, SMS]);
    for (let i = 1; i < MAX_ATTEMPTS_PER_CHANNEL; i++) {
      expect(d.registerFailure('retryable', { allowRetry: true })).toBe('retry');
      expect(d.current).toEqual(WA);
    }
    expect(d.registerFailure('retryable', { allowRetry: true })).toBe('next');
    expect(d.current).toEqual(SMS);
    expect(d.snapshot().channelAttempts).toBe(0);
    d.markSent();
    expect(d.status).toBe('sent');
    expect(d.snapshot().attempts).toBe(MAX_ATTEMPTS_PER_CHANNEL + 1);
  });

  it('permanent error and unconfigured channel switch immediately; last channel exhausts', () => {
    const d = Delivery.start([WA, SMS]);
    expect(d.registerFailure('not_configured', { allowRetry: true })).toBe('next');
    expect(d.snapshot().attempts).toBe(0);
    expect(d.registerFailure('permanent', { allowRetry: true })).toBe('exhausted');
    d.fail();
    expect(d.status).toBe('failed');
    expect(() => d.markSent()).toThrow(/invalid_transition|transition/);
  });

  it('temporary error without retry budget is final for the channel', () => {
    const d = Delivery.start([WA]);
    expect(d.registerFailure('retryable', { allowRetry: false })).toBe('exhausted');
  });

  it('reopens a sent delivery on the next channel after an asynchronous provider failure', () => {
    const d = Delivery.start([WA, SMS]);
    d.markSent();
    expect(d.reopenAfterAsyncFailure()).toBe('next');
    expect(d.status).toBe('pending');
    expect(d.current).toEqual(SMS);
    d.markSent();
    expect(d.reopenAfterAsyncFailure()).toBe('exhausted');
    expect(d.status).toBe('failed');
  });

  it('rejects empty chains and failures of finished deliveries', () => {
    expect(() => Delivery.start([])).toThrow();
    const d = Delivery.start([WA]);
    d.markSent();
    expect(() => d.registerFailure('permanent', { allowRetry: true })).toThrow();
  });

  it('aggregates message status from deliveries', () => {
    expect(aggregateMessageStatus([])).toBe('skipped');
    expect(aggregateMessageStatus(['sent', 'pending'])).toBeNull();
    expect(aggregateMessageStatus(['sent', 'sent'])).toBe('sent');
    expect(aggregateMessageStatus(['failed'])).toBe('failed');
    expect(aggregateMessageStatus(['sent', 'failed'])).toBe('partial');
    expect(MESSAGE_FSM.canTransition('sent', 'queued')).toBe(true);
    expect(MESSAGE_FSM.canTransition('failed', 'queued')).toBe(false);
  });
});

describe('delivery plan', () => {
  it('guest default: WhatsApp with SMS fallback; documents also by email', () => {
    expect(guestChannelPlan(undefined, false)).toEqual([['whatsapp', 'sms']]);
    expect(guestChannelPlan([], true)).toEqual([['email'], ['whatsapp', 'sms']]);
    expect(guestChannelPlan(['sms', 'whatsapp', 'sms'], true)).toEqual([['sms', 'whatsapp']]);
  });

  it('skips channels without address; optional email for documents is not an error', () => {
    const phoneOnly = { phone: '+77011234567', email: null, name: 'Айгерим' };
    expect(planGuestDeliveries(phoneOnly, [['email'], ['whatsapp', 'sms']])).toEqual([
      { targetKind: 'guest', staffUserId: null, recipientName: 'Айгерим', chain: [WA, SMS], requestedChannel: 'whatsapp' },
    ]);
    const emailOnly = { phone: null, email: 'guest@mail.kz', name: null };
    const plan = planGuestDeliveries(emailOnly, [['whatsapp', 'sms']]);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.chain).toEqual([]);
    expect(plan[0]!.requestedChannel).toBe('whatsapp');
    expect(planGuestDeliveries(emailOnly, [['email'], ['whatsapp', 'sms']])[0]!.chain).toEqual([
      { channel: 'email', address: 'guest@mail.kz' },
    ]);
  });

  it('staff: WhatsApp and Telegram duplicate each other, addresses are deduplicated', () => {
    const plan = planStaffDeliveries({
      members: [
        { id: 'u1', name: 'Оператор', phone: '+77010000001', telegramChatId: '555' },
        { id: 'u2', name: 'Управляющий', phone: '+77010000002', telegramChatId: null },
        { id: 'u3', name: 'Без контактов', phone: null, telegramChatId: null },
      ],
      branch: { name: 'GL', phone: '+77010000001', telegramChatId: '-100200' },
    });
    expect(plan.map((p) => `${p.targetKind}:${p.chain[0]!.channel}:${p.chain[0]!.address}`)).toEqual([
      'branch:whatsapp:+77010000001',
      'branch:telegram:-100200',
      'staff_user:telegram:555',
      'staff_user:whatsapp:+77010000002',
    ]);
  });
});

describe('masking', () => {
  it('masks addresses per channel', () => {
    expect(maskAddress('sms', '+77011234567')).toBe('+7 701 *** ** 67');
    expect(maskAddress('email', 'aigerim@mail.kz')).toBe('ai***@mail.kz');
    expect(maskEmail('a@b.kz')).toBe('a***@b.kz');
    expect(maskAddress('telegram', '-1001234567')).toBe('***4567');
    expect(maskAddress('whatsapp', '')).toBe('—');
  });

  it('separates sensitive parameters', () => {
    expect(maskParams({ code: '1234', number: '1' }, ['code'])).toEqual({ code: '***', number: '1' });
    expect(splitSensitiveParams({ code: '1234', nominal: '5 000 ₸' }, ['code'])).toEqual({
      visible: { code: '***', nominal: '5 000 ₸' },
      secret: { code: '1234' },
    });
  });
});
