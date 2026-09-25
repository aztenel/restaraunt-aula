'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ApiError, ApiClient } from '@aula/api-client';
import type { AppLocale } from '@/i18n/routing';
import type { CartLine } from '@/lib/cart';
import { toQuoteLines } from '@/lib/cart';
import { requestQuote, type OrderType, type Quote } from '@/lib/ordering';

export type QuoteStatus = 'idle' | 'loading' | 'ok' | 'unavailable' | 'error';

export interface CartQuoteState {
  status: QuoteStatus;
  /** Последний успешный расчёт (при пересчёте остаётся на экране, помечен как устаревший). */
  quote: Quote | null;
  /** Ключи строк корзины в запросе, по которому получен quote (quote.lines[i] ↔ requestKeys[i]). */
  requestKeys: string[];
  error: ApiError | null;
  /** Идёт пересчёт после изменения корзины. */
  pending: boolean;
}

const IDLE: CartQuoteState = { status: 'idle', quote: null, requestKeys: [], error: null, pending: false };
/** Пауза перед запросом: несколько нажатий «+» подряд — один расчёт. */
const DEBOUNCE_MS = 300;

export interface CartQuoteInput {
  api: Pick<ApiClient, 'POST'>;
  locale: AppLocale;
  branchId: string | null;
  type: OrderType;
  lines: CartLine[];
  promoCode?: string | null;
  certificateCode?: string | null;
  deliveryPoint?: { lat: number; lng: number } | null;
  phone?: string | null;
  enabled: boolean;
}

/**
 * Расчёт корзины на сервере (POST /public/orders/quote) при каждом изменении состава, филиала,
 * способа получения, адреса, промокода или сертификата — в корзине и на каждом шаге оформления.
 * Устаревшие запросы отменяются (AbortController).
 */
export function useCartQuote(input: CartQuoteInput): CartQuoteState & { retry: () => void } {
  const { api, locale, branchId, type, lines, enabled } = input;
  const promoCode = input.promoCode ?? null;
  const certificateCode = input.certificateCode ?? null;
  const deliveryPoint = type === 'delivery' ? (input.deliveryPoint ?? null) : null;
  const phone = input.phone ?? null;
  const [state, setState] = useState<CartQuoteState>(IDLE);
  const [attempt, setAttempt] = useState(0);

  const items = useMemo(() => toQuoteLines({ version: 1, branchId, lines, updatedAt: null }), [branchId, lines]);
  const requestKey = JSON.stringify({ branchId, type, promoCode, certificateCode, deliveryPoint, phone, items, locale });

  useEffect(() => {
    if (!enabled || !branchId || items.length === 0) {
      setState(IDLE);
      return;
    }
    const keys = lines.map((line) => line.key);
    const controller = new AbortController();
    // Прежний расчёт остаётся на экране (приглушён), пока идёт пересчёт; после ошибки — скелетон.
    setState((s) => ({ ...s, status: s.status === 'ok' ? 'ok' : 'loading', error: null, pending: true }));
    const timer = window.setTimeout(() => {
      void requestQuote(api, { branchId, type, items, promoCode, certificateCode, deliveryPoint, phone }, { locale, signal: controller.signal }).then(
        (outcome) => {
          if (controller.signal.aborted) return;
          if (outcome.kind === 'ok') {
            setState({ status: 'ok', quote: outcome.quote, requestKeys: keys, error: null, pending: false });
          } else if (outcome.kind === 'unavailable') {
            setState({ status: 'unavailable', quote: null, requestKeys: [], error: null, pending: false });
          } else {
            setState((s) => ({ ...s, status: 'error', error: outcome.error, pending: false }));
          }
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // requestKey описывает весь запрос; lines/items/api входят в него по значению.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, enabled, attempt]);

  return { ...state, retry: () => setAttempt((n) => n + 1) };
}
