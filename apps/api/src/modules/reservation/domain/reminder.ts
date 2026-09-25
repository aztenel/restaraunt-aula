import { addHours } from '../../../shared/kernel/time';

/**
 * Напоминание гостю за reminderHoursBefore часов до начала (настройка филиала).
 * null — не напоминать: 0 часов или момент напоминания уже прошёл (бронь оформлена «впритык»).
 */
export function reminderAt(start: Date, hoursBefore: number, now: Date): Date | null {
  if (!Number.isInteger(hoursBefore) || hoursBefore <= 0) return null;
  const at = addHours(start, -hoursBefore);
  return at.getTime() > now.getTime() ? at : null;
}

/** Напоминание всё ещё актуально: бронь подтверждена, не перенесена, ещё не напоминали, не началась. */
export function reminderDue(input: {
  status: string;
  start: Date;
  scheduledStart: string;
  reminderSentAt: Date | null;
  now: Date;
}): boolean {
  return (
    input.status === 'confirmed' &&
    input.start.toISOString() === input.scheduledStart &&
    input.reminderSentAt === null &&
    input.now.getTime() < input.start.getTime()
  );
}
