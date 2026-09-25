'use client';

import clsx from 'clsx';
import { useLocale, useTranslations } from 'next-intl';
import { ApiImage } from '@/components/ui/ApiImage';
import { CheckIcon, ClockIcon } from '@/components/ui/icons';
import { Notice } from '@/components/ui/Notice';
import type { AlternativeTime, Availability, VenueSlot } from '@/lib/api-types';
import { formatDate, formatLocalDate, formatPrice } from '@/lib/format';

const REASONS = ['no_capacity', 'occupied', 'past', 'too_soon', 'too_far', 'closed', 'not_accepting'] as const;

/** Время начала–окончания слота в часовом поясе витрины (Астана). */
export function useSlotTime() {
  const locale = useLocale();
  return (iso: string) => formatDate(iso, locale, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Результат поиска: свободные места (выбор — radio-карточки) или причина, почему мест нет,
 * и альтернативное время от сервера.
 */
export function VenueResults({
  availability,
  selectedId,
  onSelect,
  onAlternative,
}: {
  availability: Availability;
  selectedId: string | null;
  onSelect: (venue: VenueSlot) => void;
  onAlternative: (alternative: AlternativeTime) => void;
}) {
  const t = useTranslations('Booking');
  const locale = useLocale();
  const slotTime = useSlotTime();
  const reason = availability.reason && (REASONS as readonly string[]).includes(availability.reason) ? availability.reason : null;

  return (
    <div className="space-y-4">
      {availability.venues.length === 0 ? (
        <Notice tone="warning" title={t('noVenuesTitle')} live>
          {reason ? t(`reasons.${reason}`) : t('noVenuesText')}
        </Notice>
      ) : (
        <fieldset>
          <legend className="text-lg font-semibold text-earth-900">{t('venuesTitle', { count: availability.venues.length })}</legend>
          <div role="radiogroup" aria-label={t('venuesTitle', { count: availability.venues.length })} className="mt-3 grid gap-3 sm:grid-cols-2">
            {availability.venues.map((venue) => {
              const selected = venue.venueId === selectedId;
              const photo = venue.photos[0];
              return (
                <button
                  key={venue.venueId}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onSelect(venue)}
                  className={clsx(
                    'flex w-full gap-3 rounded-card border-2 bg-cream-50 p-3 text-left transition-colors',
                    selected ? 'border-gold-500 bg-gold-200/30' : 'border-earth-100 hover:border-earth-300',
                  )}
                >
                  {photo ? (
                    <span className="relative block aspect-square w-20 shrink-0 overflow-hidden rounded-xl bg-earth-50">
                      <ApiImage image={photo} alt="" sizes="80px" fill className="object-cover" />
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-earth-900">{venue.name}</span>
                      {selected ? <CheckIcon size={20} className="shrink-0 text-gold-600" aria-hidden="true" /> : null}
                    </span>
                    <span className="block text-sm text-earth-700">
                      {venue.typeName} · {venue.hallName}
                    </span>
                    <span className="block text-sm text-earth-800">{t('capacity', { min: venue.capacityMin, max: venue.capacityMax })}</span>
                    <span className="flex items-center gap-1 text-sm text-earth-800">
                      <ClockIcon size={16} className="shrink-0 text-earth-400" />
                      {slotTime(venue.start)}–{slotTime(venue.end)}
                    </span>
                    <span className={clsx('block text-sm font-semibold', venue.deposit ? 'text-earth-900' : 'text-steppe-700')}>
                      {venue.deposit ? t('deposit', { amount: formatPrice(venue.deposit, locale) }) : t('noDeposit')}
                    </span>
                    {venue.rules.requiresManualConfirmation ? <span className="block text-xs text-muted">{t('manualConfirmation')}</span> : null}
                    {venue.description ? <span className="line-clamp-2 block text-xs text-muted">{venue.description}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {availability.alternatives.length > 0 ? (
        <section aria-labelledby="booking-alternatives">
          <h3 id="booking-alternatives" className="font-semibold text-earth-900">
            {availability.venues.length === 0 ? t('alternativesTitle') : t('alternativesMore')}
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {availability.alternatives.map((alt) => (
              <li key={alt.start}>
                <button
                  type="button"
                  onClick={() => onAlternative(alt)}
                  className="min-h-11 rounded-full border border-earth-200 bg-cream-50 px-4 text-sm font-semibold text-earth-900 hover:border-earth-400"
                >
                  {alt.date === availability.date ? alt.time : `${formatLocalDate(alt.date, locale)}, ${alt.time}`}
                  <span className="sr-only"> — {t('alternativeVenues', { count: alt.venueIds.length })}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
