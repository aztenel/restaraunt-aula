import { Injectable, Logger } from '@nestjs/common';
import { ZodType } from 'zod';
import { ExternalHttp, ExternalServiceError } from '../../../../../shared/infrastructure/integrations/external-http';
import { IntegrationSettings } from '../../../../../shared/infrastructure/settings/integration-settings';
import { ValidationError } from '../../../../../shared/kernel/errors';
import { CourierClaimInfo, CourierClaimRef, CourierClaimRequest, CourierDispatch } from '../../../domain/courier-dispatch';
import { apiErrorMessage, buildCreateClaimBody, hasPerformer, parseClaim, parseCourierPhone, parseTrackingLink } from './yandex-delivery.payload';
import {
  YANDEX_DELIVERY_PROVIDER,
  YANDEX_DELIVERY_SETTINGS_KEY,
  YandexDeliverySettings,
  YandexDeliverySettingsSchema,
} from './yandex-delivery.settings';

const SETTINGS_SCHEMA = YandexDeliverySettingsSchema as unknown as ZodType<YandexDeliverySettings>;
const CLAIMS = '/b2b/cargo/integration/v2/claims';

/**
 * Адаптер Яндекс.Доставки (B2B API, заявки cargo claims v2): создание заявки с точками маршрута и
 * позициями, подтверждение после оценки, статус/курьер/ссылка отслеживания, отмена.
 * Вызывается только из фоновых задач; ошибки — ExternalServiceError (5xx/429/сеть — повторяемые).
 * Идемпотентность создания — request_id = id нашей заявки.
 */
@Injectable()
export class YandexCourierDispatch extends CourierDispatch {
  readonly provider = YANDEX_DELIVERY_PROVIDER;
  readonly external = true;
  private readonly logger = new Logger(YandexCourierDispatch.name);

  constructor(
    private readonly http: ExternalHttp,
    private readonly settings: IntegrationSettings,
  ) {
    super();
  }

  async createClaim(request: CourierClaimRequest): Promise<CourierClaimInfo> {
    const settings = await this.config();
    const body = await this.call(settings, 'claims_create', `${CLAIMS}/create?request_id=${encodeURIComponent(request.dispatchId)}`, buildCreateClaimBody(request, settings), request.orderId);
    return parseClaim(body).info;
  }

  async getClaim(ref: CourierClaimRef): Promise<CourierClaimInfo> {
    const settings = await this.config();
    const claim = parseClaim(await this.info(settings, ref));
    const info = { ...claim.info, trackingUrl: ref.known?.trackingUrl ?? null, courierPhone: ref.known?.courierPhone ?? null };
    if (hasPerformer(info.status)) {
      // Ссылка отслеживания и телефон курьера — дополнительные данные: их сбой не срывает опрос статуса.
      if (!info.trackingUrl) info.trackingUrl = await this.optional(() => this.trackingLink(settings, ref), ref, 'tracking_links');
      if (!info.courierPhone) info.courierPhone = await this.optional(() => this.courierPhone(settings, ref), ref, 'driver_voiceforwarding');
    }
    return info;
  }

  async confirmClaim(ref: CourierClaimRef): Promise<CourierClaimInfo> {
    const settings = await this.config();
    const claim = parseClaim(await this.info(settings, ref));
    if (claim.status !== 'ready_for_approval') return claim.info;
    const accepted = parseClaim(
      await this.call(settings, 'claims_accept', `${CLAIMS}/accept?claim_id=${encodeURIComponent(ref.externalId)}`, { version: claim.version ?? 1 }, ref.orderId),
    );
    return { ...claim.info, status: accepted.info.status, providerStatus: accepted.status };
  }

  async cancelClaim(ref: CourierClaimRef): Promise<void> {
    const settings = await this.config();
    const claim = parseClaim(await this.info(settings, ref));
    if (claim.info.status === 'cancelled' || claim.info.status === 'delivered' || claim.info.status === 'failed') return;
    const cancelInfo = (await this.call(settings, 'claims_cancel_info', `${CLAIMS}/cancel-info?claim_id=${encodeURIComponent(ref.externalId)}`, {}, ref.orderId)) as {
      cancel_state?: string;
    };
    const state = cancelInfo?.cancel_state;
    if (state !== 'free' && state !== 'paid') {
      throw new ExternalServiceError(YANDEX_DELIVERY_SETTINGS_KEY, `Claim cannot be cancelled (cancel_state=${state ?? 'unknown'})`, false);
    }
    await this.call(
      settings,
      'claims_cancel',
      `${CLAIMS}/cancel?claim_id=${encodeURIComponent(ref.externalId)}`,
      { version: claim.version ?? 1, cancel_state: state },
      ref.orderId,
    );
  }

  private async info(settings: YandexDeliverySettings, ref: CourierClaimRef): Promise<unknown> {
    return this.call(settings, 'claims_info', `${CLAIMS}/info?claim_id=${encodeURIComponent(ref.externalId)}`, {}, ref.orderId);
  }

  private async trackingLink(settings: YandexDeliverySettings, ref: CourierClaimRef): Promise<string | null> {
    return parseTrackingLink(
      await this.call(settings, 'tracking_links', `${CLAIMS}/tracking-links?claim_id=${encodeURIComponent(ref.externalId)}`, undefined, ref.orderId, 'GET'),
    );
  }

  private async courierPhone(settings: YandexDeliverySettings, ref: CourierClaimRef): Promise<string | null> {
    return parseCourierPhone(
      await this.call(settings, 'driver_voiceforwarding', '/b2b/cargo/integration/v2/driver-voiceforwarding', { claim_id: ref.externalId }, ref.orderId),
    );
  }

  private async optional<T>(fn: () => Promise<T | null>, ref: CourierClaimRef, operation: string): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      this.logger.warn({ orderId: ref.orderId, operation, err: err instanceof Error ? err.message : String(err) }, 'Optional courier data unavailable');
      return null;
    }
  }

  private async config(): Promise<YandexDeliverySettings> {
    const settings = await this.settings.get(YANDEX_DELIVERY_SETTINGS_KEY, SETTINGS_SCHEMA);
    if (!settings) {
      throw new ValidationError('integration.not_configured', 'Courier service integration is not configured or disabled', {
        key: YANDEX_DELIVERY_SETTINGS_KEY,
      });
    }
    return settings;
  }

  private async call(
    settings: YandexDeliverySettings,
    operation: string,
    path: string,
    body: unknown,
    correlationId: string,
    method: 'GET' | 'POST' = 'POST',
  ): Promise<unknown> {
    try {
      const res = await this.http.request({
        integration: YANDEX_DELIVERY_SETTINGS_KEY,
        operation,
        method,
        url: `${settings.baseUrl}${path}`,
        headers: { authorization: `Bearer ${settings.token}`, 'accept-language': 'ru' },
        body: method === 'GET' ? undefined : body,
        timeoutMs: settings.timeoutMs,
        correlationId,
      });
      return res.body;
    } catch (err) {
      if (err instanceof ExternalServiceError) {
        const details = apiErrorMessage(err.responseBody);
        if (details) {
          throw new ExternalServiceError(err.integration, `${err.message.replace(/^\[[^\]]+\]\s*/, '')}: ${details}`, err.retryable, err.statusCode, err.responseBody);
        }
      }
      throw err;
    }
  }
}
