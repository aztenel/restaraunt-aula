/**
 * @aula/api-client — типизированный клиент AULA API и общие для фронтендов помощники
 * (деньги, языки, ошибки). Бизнес-расчётов здесь нет: фронтенды только отображают то,
 * что посчитал сервер.
 */
export { call, createApiClient, buildQueryString } from './client';
export type { ApiClient, ApiClientOptions, ApiPaths, HttpMethod, RawRequestInit, UnauthorizedContext } from './client';

export { ApiError, isApiError, isApiErrorBody, toApiError, NETWORK_ERROR_CODE, UNKNOWN_ERROR_CODE } from './errors';
export type { ApiErrorBody, ApiErrorPayload } from './errors';

export {
  CURRENCY_SEPARATOR,
  GROUP_SEPARATOR,
  MINOR_UNITS_PER_MAJOR,
  MINUS_SIGN,
  formatFixed2ForInput,
  formatMoney,
  formatTiyn,
  parseFixed2,
  parseTengeToTiyn,
} from './money';
export type { Currency, FormatMoneyOptions, Money, ParseFixedError, ParseFixedOptions, ParseFixedResult } from './money';

export { DEFAULT_LOCALE, LOCALES, REQUIRED_CONTENT_LOCALES, isLocale, missingLocales, translate } from './i18n';
export type { Locale, Translatable } from './i18n';

export { STAFF_ROLES, WEEKDAYS } from './types';
export type * from './types';

export type { components, operations, paths } from './schema';
