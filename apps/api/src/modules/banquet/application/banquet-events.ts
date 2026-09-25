import { Money } from '../../../shared/kernel/money';
import { BanquetRequest, BanquetTransition } from '../domain/banquet-request';
import { BanquetRequestAssignedPayload, BanquetRequestCreatedPayload, BanquetStatusChangedPayload } from '../public';

/** Payload событий заявки (контракт public/index.ts): только JSON-совместимые данные. */
export function requestCreatedPayload(request: BanquetRequest, now: Date): BanquetRequestCreatedPayload {
  const s = request.snapshot();
  return {
    requestId: s.id,
    number: s.number,
    branchId: s.branchId,
    isOffsite: s.isOffsite,
    eventDate: s.eventDate,
    eventType: s.eventType,
    guests: s.guests,
    budget: s.budget?.toJSON() ?? null,
    managerId: s.managerId,
    contact: request.contact(),
    source: s.source,
    occurredAt: now.toISOString(),
  };
}

export function statusChangedPayload(request: BanquetRequest, t: BanquetTransition, quoteTotal: Money | null): BanquetStatusChangedPayload {
  const s = request.snapshot();
  return {
    requestId: s.id,
    number: s.number,
    branchId: s.branchId,
    isOffsite: s.isOffsite,
    from: t.from,
    to: t.to,
    managerId: s.managerId,
    eventDate: s.eventDate,
    guests: s.guests,
    quoteTotal: quoteTotal?.toJSON() ?? null,
    contact: request.contact(),
    reason: t.reason,
    occurredAt: t.at.toISOString(),
  };
}

export function requestAssignedPayload(request: BanquetRequest, previousManagerId: string | null, now: Date): BanquetRequestAssignedPayload {
  const s = request.snapshot();
  return {
    requestId: s.id,
    number: s.number,
    branchId: s.branchId,
    managerId: s.managerId,
    previousManagerId,
    occurredAt: now.toISOString(),
  };
}
