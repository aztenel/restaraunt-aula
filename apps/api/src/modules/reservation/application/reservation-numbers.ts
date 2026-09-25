import { Injectable } from '@nestjs/common';
import { DocumentNumbering } from '../../../shared/infrastructure/database/numbering';
import { zonedParts } from '../../../shared/kernel/time';
import { BranchInfo } from '../../identity/public';

/** Последовательность номеров броней в разрезе филиала и года (часовой пояс филиала). */
export const RESERVATION_NUMBER_SCOPE = 'reservation';

/**
 * Номер брони: <код филиала>-R-<год>-<номер>, например GL-R-2026-000123. Буква R отличает бронь
 * от заказа с тем же порядковым номером. Вызывать в транзакции создания брони.
 */
@Injectable()
export class ReservationNumbers {
  constructor(private readonly numbering: DocumentNumbering) {}

  async next(branch: BranchInfo, now: Date): Promise<string> {
    const year = zonedParts(now, branch.timezone).year;
    const value = await this.numbering.next(RESERVATION_NUMBER_SCOPE, branch.id, year);
    return DocumentNumbering.format(`${branch.code}-R`, year, value);
  }
}
