import clsx from 'clsx';
import { getTranslations } from 'next-intl/server';
import { WEEKDAYS, type OpeningHours } from '@aula/api-client';
import { endsNextDay, formatInterval, intervalsFor, weekdayInTimeZone } from '@/lib/hours';

/** Таблица часов работы по дням недели; интервалы через полночь подписываются «до … следующего дня». */
export async function OpeningHoursTable({ hours, timeZone }: { hours: OpeningHours; timeZone: string }) {
  const t = await getTranslations('Branches');
  const days = await getTranslations('Weekdays');
  const today = weekdayInTimeZone(new Date(), timeZone);
  return (
    <table className="w-full text-left">
      <caption className="sr-only">{t('hours')}</caption>
      <tbody>
        {WEEKDAYS.map((day) => {
          const intervals = intervalsFor(hours, day);
          const isToday = day === today;
          return (
            <tr key={day} className={clsx('border-b border-earth-100 last:border-0', isToday && 'bg-gold-200/40 font-semibold')}>
              <th scope="row" className="py-2.5 pl-3 pr-4 font-medium text-earth-800">
                {days(day)}
                {isToday ? <span className="ml-2 text-xs font-bold uppercase text-gold-700">{t('today')}</span> : null}
              </th>
              <td className="py-2.5 pr-3 text-right tabular-nums text-earth-900">
                {intervals.length === 0 ? (
                  <span className="text-muted">{t('dayOff')}</span>
                ) : (
                  intervals.map((interval) => (
                    <span key={`${interval.open}-${interval.close}`} className="block">
                      {formatInterval(interval)}
                      {endsNextDay(interval) ? (
                        <span className="block text-xs font-normal text-muted">{t('nextDay', { time: interval.close })}</span>
                      ) : null}
                    </span>
                  ))
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
