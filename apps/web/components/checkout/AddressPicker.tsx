'use client';

import clsx from 'clsx';
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { FormField, inputBase, inputClass } from '@/components/forms/FormField';
import { buttonClasses } from '@/components/ui/button';
import { MapPinIcon, SearchIcon } from '@/components/ui/icons';
import type { DeliveryZone, GeoPoint } from '@/lib/api-types';
import { CHECKOUT_LIMITS, type DeliveryAddress, type DeliveryDecision } from '@/lib/checkout';
import { formatPrice } from '@/lib/format';
import { DEFAULT_CENTER, geocoderBaseUrl, reverseGeocode, searchAddress, type GeocodeResult } from '@/lib/geocoder';
import { DeliveryMap } from './DeliveryMap';

export type ResolutionView =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | DeliveryDecision;

export interface AddressErrors {
  addressText?: string;
  point?: string;
  apartment?: string;
  entrance?: string;
  floor?: string;
  intercom?: string;
  courierComment?: string;
}

/**
 * Адрес доставки: текст + точка на карте. Геокодирование — в браузере (lib/geocoder.ts), если
 * настроен NEXT_PUBLIC_GEOCODER_URL; иначе (или если адрес не нашёлся) гость ставит метку вручную.
 * Филиал, зону, стоимость и минимальную сумму для точки определяет сервер (POST /public/delivery/resolve).
 */
export function AddressPicker({
  idPrefix,
  address,
  onChange,
  zones,
  resolution,
  onConfirmSwitch,
  errors,
}: {
  idPrefix: string;
  address: DeliveryAddress;
  onChange: (patch: Partial<DeliveryAddress>) => void;
  zones: DeliveryZone[];
  resolution: ResolutionView;
  onConfirmSwitch: () => void;
  errors: AddressErrors;
}) {
  const t = useTranslations('Checkout.address');
  const locale = useLocale();
  const geocoderEnabled = geocoderBaseUrl() !== null;
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const id = (field: string) => `${idPrefix}-${field}`;

  const pick = (point: GeoPoint, label?: string) => {
    onChange(label ? { point, addressText: label } : { point });
    setResults(null);
  };

  /** Точка на карте → адрес текстом (если поле ещё пустое). */
  const pickOnMap = (point: GeoPoint) => {
    onChange({ point });
    setResults(null);
    if (!geocoderEnabled || address.addressText.trim()) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    reverseGeocode(point, { locale, signal: controller.signal })
      .then((found) => {
        if (found && !controller.signal.aborted) onChange({ addressText: found.label });
      })
      .catch(() => undefined);
  };

  const search = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!geocoderEnabled || address.addressText.trim().length < 3) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setSearching(true);
    setNotice(null);
    try {
      const found = await searchAddress(address.addressText, { locale, signal: controller.signal });
      setResults(found);
      if (found.length === 0) setNotice(t('notFound'));
    } catch {
      if (!controller.signal.aborted) setNotice(t('geocoderUnavailable'));
    } finally {
      setSearching(false);
    }
  };

  const onAddressKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void search();
    }
  };

  const locate = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setNotice(t('locateUnavailable'));
      return;
    }
    setLocating(true);
    setNotice(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        pickOnMap({ lat: position.coords.latitude, lng: position.coords.longitude });
      },
      () => {
        setLocating(false);
        setNotice(t('locateDenied'));
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  return (
    <div className="space-y-4">
      <FormField id={id('addressText')} label={t('label')} error={errors.addressText} hint={geocoderEnabled ? t('hint') : t('hintManual')}>
        <div className="mt-1 flex gap-2">
          <input
            id={id('addressText')}
            value={address.addressText}
            onChange={(e) => onChange({ addressText: e.target.value.slice(0, CHECKOUT_LIMITS.addressMax) })}
            onKeyDown={onAddressKey}
            autoComplete="street-address"
            placeholder={t('placeholder')}
            aria-invalid={Boolean(errors.addressText)}
            aria-describedby={errors.addressText ? `${id('addressText')}-error` : `${id('addressText')}-hint`}
            className={clsx(inputBase, 'min-w-0 flex-1')}
          />
          {geocoderEnabled ? (
            <button type="button" onClick={() => void search()} disabled={searching} className={buttonClasses('outline', 'md', 'shrink-0')}>
              <SearchIcon size={18} />
              <span className="max-[400px]:sr-only">{searching ? t('searching') : t('search')}</span>
            </button>
          ) : null}
        </div>
      </FormField>

      {results && results.length > 0 ? (
        <ul className="space-y-1 rounded-2xl border border-earth-100 bg-cream-50 p-2" aria-label={t('results')}>
          {results.map((result) => (
            <li key={`${result.point.lat},${result.point.lng}`}>
              <button
                type="button"
                onClick={() => pick(result.point, result.label)}
                className="flex min-h-11 w-full items-start gap-2 rounded-xl px-3 py-2 text-left hover:bg-earth-50"
              >
                <MapPinIcon size={18} className="mt-0.5 shrink-0 text-earth-400" />
                <span>
                  <span className="block font-semibold text-earth-900">{result.label}</span>
                  <span className="block text-xs text-muted">{result.fullLabel}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div aria-live="polite">{notice ? <p className="text-sm text-earth-700">{notice}</p> : null}</div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p id={id('point')} className="text-sm font-semibold text-earth-800">
            {t('mapLabel')}
          </p>
          <button type="button" onClick={locate} disabled={locating} className={buttonClasses('ghost', 'sm')}>
            <MapPinIcon size={18} />
            {locating ? t('locating') : t('locate')}
          </button>
        </div>
        <DeliveryMap center={address.point ?? DEFAULT_CENTER} point={address.point} zones={zones} onPick={pickOnMap} label={t('mapAria')} />
        <p className="mt-1 text-xs text-muted">{t('mapHint')}</p>
        <div aria-live="polite" className="mt-2">
          <ResolutionStatus resolution={resolution} onConfirmSwitch={onConfirmSwitch} locale={locale} />
          {errors.point && resolution.status !== 'not_deliverable' ? (
            <p id={`${id('point')}-error`} className="mt-1 text-sm font-semibold text-terracotta-600">
              {errors.point}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(['apartment', 'entrance', 'floor', 'intercom'] as const).map((part) => (
          <FormField key={part} id={id(part)} label={t(part)} error={errors[part]} optional>
            <input
              id={id(part)}
              value={address[part]}
              onChange={(e) => onChange({ [part]: e.target.value.slice(0, CHECKOUT_LIMITS.addressPartMax) })}
              autoComplete="off"
              aria-invalid={Boolean(errors[part])}
              className={inputClass}
            />
          </FormField>
        ))}
      </div>
      <FormField id={id('courierComment')} label={t('courierComment')} error={errors.courierComment} optional>
        <textarea
          id={id('courierComment')}
          value={address.courierComment}
          onChange={(e) => onChange({ courierComment: e.target.value.slice(0, CHECKOUT_LIMITS.courierCommentMax) })}
          rows={2}
          aria-invalid={Boolean(errors.courierComment)}
          className={clsx(inputClass, 'py-2')}
        />
      </FormField>
    </div>
  );
}

function ResolutionStatus({ resolution, onConfirmSwitch, locale }: { resolution: ResolutionView; onConfirmSwitch: () => void; locale: string }) {
  const t = useTranslations('Checkout.address');
  switch (resolution.status) {
    case 'loading':
      return <p className="text-sm text-muted">{t('checking')}</p>;
    case 'error':
      return <p className="text-sm font-semibold text-terracotta-600">{t('checkError')}</p>;
    case 'not_deliverable':
      return (
        <p className="rounded-2xl border border-terracotta-500/40 bg-terracotta-500/5 p-3 text-sm font-semibold text-terracotta-600">{t('notDeliverable')}</p>
      );
    case 'deliverable': {
      const { branch, zone } = resolution.option;
      return (
        <p className="rounded-2xl border border-steppe-700/30 bg-steppe-100 p-3 text-sm text-steppe-700">
          <span className="font-semibold">{t('deliverable', { branch: branch.name })}</span>{' '}
          {t('zoneInfo', {
            eta: zone.etaMinutes,
            fee: zone.deliveryFee.amount > 0 ? formatPrice(zone.deliveryFee, locale) : t('free'),
            min: formatPrice(zone.minOrderAmount, locale),
          })}
          {zone.freeDeliveryFrom ? ` ${t('freeFrom', { amount: formatPrice(zone.freeDeliveryFrom, locale) })}` : null}
        </p>
      );
    }
    case 'switch':
      return (
        <div role="alertdialog" aria-labelledby="branch-switch-title" className="rounded-2xl border border-gold-400 bg-gold-200/40 p-3 text-sm text-earth-900">
          <p id="branch-switch-title" className="font-semibold">
            {t('switchTitle', { branch: resolution.option.branch.name })}
          </p>
          <p className="mt-1">{t('switchText')}</p>
          <button type="button" onClick={onConfirmSwitch} className={buttonClasses('primary', 'sm', 'mt-2')}>
            {t('switchConfirm', { branch: resolution.option.branch.name })}
          </button>
        </div>
      );
    default:
      return null;
  }
}
