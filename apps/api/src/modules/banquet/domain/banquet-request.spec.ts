import { describe, expect, it } from 'vitest';
import { ConflictError, InvalidStateTransitionError, ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { BanquetRequest, validateDetails } from './banquet-request';

const now = new Date('2026-10-01T06:00:00Z');

function request(overrides: Partial<Parameters<typeof BanquetRequest.create>[0]> = {}) {
  return BanquetRequest.create({
    id: 'r1',
    number: 'GL-B-2026-000001',
    source: 'web',
    branchId: 'b1',
    isOffsite: false,
    offsiteAddress: null,
    eventDate: '2026-10-20',
    eventTime: '18:00',
    eventType: 'wedding',
    guests: 120,
    budget: Money.tenge(3_000_000),
    contact: { customerId: 'c1', name: 'Айгерим', phone: '+77771234567', email: null },
    wishes: null,
    locale: 'ru',
    managerId: 'm1',
    assignedAt: now,
    companyId: null,
    publicToken: 'tok',
    createdAt: now,
    ...overrides,
  });
}

describe('validateDetails', () => {
  const today = '2026-10-01';
  const base = { eventDate: '2026-10-20', eventType: 'wedding', guests: 100, branchId: 'b1' };

  it('accepts a branch request and normalizes optional fields', () => {
    const d = validateDetails({ ...base, eventTime: ' 19:30 ', wishes: '  ', budget: null }, today, { checkDate: true });
    expect(d).toMatchObject({ eventTime: '19:30', wishes: null, isOffsite: false, offsiteAddress: null, branchId: 'b1' });
  });

  it('requires a branch or offsite address', () => {
    expect(() => validateDetails({ ...base, branchId: null }, today, { checkDate: true })).toThrow(/Branch is required/);
    expect(() => validateDetails({ ...base, branchId: null, isOffsite: true }, today, { checkDate: true })).toThrow(ValidationError);
    const offsite = validateDetails({ ...base, branchId: null, isOffsite: true, offsiteAddress: 'Астана, ул. Сыганак 10' }, today, {
      checkDate: true,
    });
    expect(offsite).toMatchObject({ isOffsite: true, branchId: null, offsiteAddress: 'Астана, ул. Сыганак 10' });
  });

  it('validates date, time, type and guests', () => {
    const check = (patch: Record<string, unknown>, code: string) => {
      try {
        validateDetails({ ...base, ...patch } as never, today, { checkDate: true });
        throw new Error('expected failure');
      } catch (err) {
        expect((err as ValidationError).code).toBe(code);
      }
    };
    check({ eventDate: '2026-09-30' }, 'banquet.event_date_in_past');
    check({ eventDate: '2029-01-01' }, 'banquet.event_date_too_far');
    check({ eventDate: '01.10.2026' }, 'banquet.invalid_event_date');
    check({ eventTime: '25:00' }, 'banquet.invalid_event_time');
    check({ eventType: 'party' }, 'banquet.invalid_event_type');
    check({ guests: 0 }, 'banquet.invalid_guests');
    check({ guests: 10.5 }, 'banquet.invalid_guests');
    check({ budget: Money.of(-1) }, 'banquet.invalid_budget');
    // Дата в прошлом допустима при правке без смены даты.
    expect(validateDetails({ ...base, eventDate: '2026-09-01' }, today, { checkDate: false }).eventDate).toBe('2026-09-01');
  });

  it('knows all event types from the spec, including kudalyk and memorial', () => {
    for (const t of ['wedding', 'birthday', 'corporate', 'anniversary', 'kudalyk', 'memorial', 'graduation', 'other']) {
      expect(validateDetails({ ...base, eventType: t }, today, { checkDate: true }).eventType).toBe(t);
    }
  });
});

describe('BanquetRequest', () => {
  it('always has a responsible manager', () => {
    expect(() => request({ managerId: '' })).toThrow(ConflictError);
    const r = request();
    expect(() => r.assign('', now)).toThrow(ConflictError);
    expect(r.assign('m2', now)).toBe('m1');
    expect(r.managerId).toBe('m2');
  });

  it('moves only along the funnel and records transitions', () => {
    const r = request();
    expect(() => r.transition('agreed', now)).toThrow(InvalidStateTransitionError);
    r.transition('in_progress', now);
    r.transition('quote_sent', now);
    r.transition('agreed', now);
    r.transition('prepaid', now);
    r.transition('held', now);
    expect(r.snapshot().heldAt).toEqual(now);
    expect(r.pullTransitions().map((t) => `${t.from}->${t.to}`)).toEqual([
      'new->in_progress',
      'in_progress->quote_sent',
      'quote_sent->agreed',
      'agreed->prepaid',
      'prepaid->held',
    ]);
    expect(r.pullTransitions()).toEqual([]);
    expect(() => r.assertOpen()).toThrow(ConflictError);
  });

  it('stores the cancel reason', () => {
    const r = request();
    r.transition('cancelled', now, 'Гость передумал');
    expect(r.snapshot()).toMatchObject({ status: 'cancelled', cancelReason: 'Гость передумал', cancelledAt: now });
  });

  it('marks the first response once', () => {
    const r = request();
    expect(r.markResponded(now)).toBe(true);
    expect(r.markResponded(new Date(now.getTime() + 1000))).toBe(false);
    expect(r.snapshot().firstResponseAt).toEqual(now);
  });

  it('detects SLA breach after 30 minutes without response', () => {
    const r = request();
    expect(r.isSlaBreached(new Date(now.getTime() + 29 * 60_000))).toBe(false);
    expect(r.isSlaBreached(new Date(now.getTime() + 30 * 60_000))).toBe(true);
    r.markResponded(new Date(now.getTime() + 31 * 60_000));
    expect(r.isSlaBreached(new Date(now.getTime() + 60 * 60_000))).toBe(false);
  });

  describe('prepayment', () => {
    it('defaults to 50% of the quote total and can be set by the manager', () => {
      const r = request();
      const total = Money.tenge(1_000_001);
      expect(r.requiredPrepayment(null)).toBeNull();
      expect(r.requiredPrepayment(total)?.amount).toBe(50_000_050);
      r.applyDefaultPrepayment(total);
      expect(r.snapshot().prepaymentAmount?.amount).toBe(50_000_050);
      r.setPrepayment(Money.tenge(200_000));
      r.applyDefaultPrepayment(Money.tenge(5_000_000));
      expect(r.requiredPrepayment(total)?.amount).toBe(20_000_000);
      expect(() => r.setPrepayment(Money.of(-1))).toThrow(ValidationError);
      r.setPrepayment(null);
      expect(r.snapshot().prepaymentIsCustom).toBe(false);
      expect(r.requiredPrepayment(total)?.amount).toBe(50_000_050);
    });

    it('is covered when paid >= required; zero only when explicitly set', () => {
      const r = request();
      const total = Money.tenge(100_000);
      expect(r.isPrepaymentCovered(Money.tenge(49_999), total)).toBe(false);
      expect(r.isPrepaymentCovered(Money.tenge(50_000), total)).toBe(true);
      expect(r.isPrepaymentCovered(Money.zero(), Money.zero())).toBe(false);
      r.setPrepayment(Money.zero());
      expect(r.isPrepaymentCovered(Money.zero(), total)).toBe(true);
    });
  });
});
