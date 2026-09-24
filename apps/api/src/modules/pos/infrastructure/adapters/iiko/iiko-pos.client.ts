import { Injectable } from '@nestjs/common';
import { ZodType } from 'zod';
import { ExternalHttp, ExternalServiceError } from '../../../../../shared/infrastructure/integrations/external-http';
import { IntegrationSettings } from '../../../../../shared/infrastructure/settings/integration-settings';
import { Clock } from '../../../../../shared/kernel/clock';
import { DomainError, ValidationError } from '../../../../../shared/kernel/errors';
import { KitchenOrder } from '../../../../ordering/public';
import {
  POS_NOT_CONFIGURED,
  PosBranchRef,
  PosCapabilities,
  PosClient,
  PosOrderCheck,
  PosOrderMapping,
  PosProduct,
  PosPushResult,
  PosStopListItem,
} from '../../../domain/pos-client';
import {
  buildDeliveryRequest,
  iikoErrorMessage,
  parseCreateDeliveryResponse,
  parseDeliveryById,
  parseNomenclature,
  parseStopLists,
} from './iiko-payload';
import { IIKO_PROVIDER, IIKO_SETTINGS_KEY, IIKO_TOKEN_TTL_MS, IikoBranchSettings, IikoSettings, IikoSettingsSchema } from './iiko.settings';

/**
 * Тело запроса токена. apiLogin — секрет, но общий журнал интеграций маскирует только известные
 * ключи (token, password, ...). Поэтому в журнал попадает замаскированное перечисляемое поле,
 * а настоящее значение хранится в приватном поле и уходит в сеть через toJSON().
 */
class AccessTokenBody {
  readonly #apiLogin: string;
  readonly apiLogin: string;

  constructor(apiLogin: string) {
    this.#apiLogin = apiLogin;
    this.apiLogin = apiLogin.length > 4 ? `***${apiLogin.slice(-4)}` : '***';
  }

  toJSON(): { apiLogin: string } {
    return { apiLogin: this.#apiLogin };
  }
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

interface BranchContext {
  settings: IikoSettings;
  branch: IikoBranchSettings;
}

/** Схема с значениями по умолчанию: вход и выход различаются, get() типизирован по выходу. */
const SETTINGS_SCHEMA = IikoSettingsSchema as unknown as ZodType<IikoSettings>;

/** Ответ «заказ уже существует»: заказ с нашим id уже создан предыдущей попыткой (например, после таймаута). */
const DUPLICATE_ORDER_RE = /already exist|уже существует|duplicate/i;

/**
 * Адаптер iikoCloud API: заказы доставки/самовывоза (deliveries/create, проверка создания — deliveries/by_id),
 * стоп-листы, номенклатура.
 * Токен доступа кэшируется ~50 минут; при 401 — один повтор с новым токеном.
 */
@Injectable()
export class IikoPosClient extends PosClient {
  readonly provider = IIKO_PROVIDER;
  readonly capabilities: PosCapabilities = { pushOrders: true, stopList: true, nomenclature: true };

  private readonly tokens = new Map<string, CachedToken>();
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(
    private readonly http: ExternalHttp,
    private readonly settings: IntegrationSettings,
    private readonly clock: Clock,
  ) {
    super();
  }

  async isConfigured(branch: PosBranchRef): Promise<boolean> {
    try {
      const settings = await this.settings.get(IIKO_SETTINGS_KEY, SETTINGS_SCHEMA);
      return !!settings?.branches[branch.branchId];
    } catch (err) {
      if (err instanceof DomainError) return false;
      throw err;
    }
  }

  async pushOrder(order: KitchenOrder, mapping: PosOrderMapping): Promise<PosPushResult> {
    const ctx = await this.context(order.branchId);
    const body = buildDeliveryRequest(order, mapping, ctx.branch);
    try {
      const res = await this.call(ctx.settings, 'deliveries_create', '/api/1/deliveries/create', body, order.orderId);
      const parsed = parseCreateDeliveryResponse(res);
      if (parsed.creationStatus === 'Error') {
        throw new ExternalServiceError(IIKO_SETTINGS_KEY, `Order rejected: ${parsed.error ?? 'creation error'}`, false, 200, res);
      }
      // Мы передаём свой id заказа — iiko использует его как id заказа в POS.
      // Создание асинхронное: InProgress подтверждается позже (checkOrder -> deliveries/by_id).
      return { posOrderId: parsed.posOrderId ?? order.orderId, confirmed: parsed.creationStatus === 'Success' };
    } catch (err) {
      if (err instanceof ExternalServiceError && err.statusCode === 400 && DUPLICATE_ORDER_RE.test(iikoErrorMessage(err.responseBody) ?? '')) {
        return { posOrderId: order.orderId, confirmed: false };
      }
      throw this.withDetails(err);
    }
  }

  override async checkOrder(branch: PosBranchRef, posOrderId: string): Promise<PosOrderCheck> {
    const ctx = await this.context(branch.branchId);
    try {
      const res = await this.call(
        ctx.settings,
        'deliveries_by_id',
        '/api/1/deliveries/by_id',
        { organizationId: ctx.branch.organizationId, orderIds: [posOrderId] },
        posOrderId,
      );
      return parseDeliveryById(res, posOrderId);
    } catch (err) {
      throw this.withDetails(err);
    }
  }

  async fetchStopList(branch: PosBranchRef): Promise<PosStopListItem[]> {
    const ctx = await this.context(branch.branchId);
    try {
      const res = await this.call(ctx.settings, 'stop_lists', '/api/1/stop_lists', { organizationIds: [ctx.branch.organizationId] }, branch.branchId);
      return parseStopLists(res, ctx.branch);
    } catch (err) {
      throw this.withDetails(err);
    }
  }

  async fetchProducts(branch: PosBranchRef): Promise<PosProduct[]> {
    const ctx = await this.context(branch.branchId);
    try {
      const res = await this.call(ctx.settings, 'nomenclature', '/api/1/nomenclature', { organizationId: ctx.branch.organizationId }, branch.branchId);
      return parseNomenclature(res);
    } catch (err) {
      throw this.withDetails(err);
    }
  }

  private async context(branchId: string): Promise<BranchContext> {
    const settings = await this.settings.get(IIKO_SETTINGS_KEY, SETTINGS_SCHEMA);
    if (!settings) {
      throw new ValidationError(POS_NOT_CONFIGURED, 'POS integration is disabled or not configured', { key: IIKO_SETTINGS_KEY });
    }
    const branch = settings.branches[branchId];
    if (!branch) {
      throw new ValidationError(POS_NOT_CONFIGURED, 'POS organization is not configured for the branch', { key: IIKO_SETTINGS_KEY, branchId });
    }
    return { settings, branch };
  }

  /** Запрос с токеном; при 401 токен сбрасывается и запрос повторяется один раз. */
  private async call(settings: IikoSettings, operation: string, path: string, body: unknown, correlationId: string): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      const token = await this.token(settings, correlationId);
      try {
        const res = await this.http.request({
          integration: IIKO_SETTINGS_KEY,
          operation,
          method: 'POST',
          url: `${settings.baseUrl}${path}`,
          headers: { authorization: `Bearer ${token}` },
          body,
          timeoutMs: settings.timeoutMs,
          correlationId,
        });
        return res.body;
      } catch (err) {
        if (attempt === 1 && err instanceof ExternalServiceError && err.statusCode === 401) {
          this.tokens.delete(this.tokenKey(settings));
          continue;
        }
        throw err;
      }
    }
  }

  private tokenKey(settings: IikoSettings): string {
    return `${settings.baseUrl}|${settings.apiLogin}`;
  }

  private async token(settings: IikoSettings, correlationId: string): Promise<string> {
    const key = this.tokenKey(settings);
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt > this.clock.now().getTime()) return cached.token;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const request = this.requestToken(settings, correlationId).finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    return request;
  }

  private async requestToken(settings: IikoSettings, correlationId: string): Promise<string> {
    const res = await this.http.request<{ token?: unknown }>({
      integration: IIKO_SETTINGS_KEY,
      operation: 'access_token',
      method: 'POST',
      url: `${settings.baseUrl}/api/1/access_token`,
      body: new AccessTokenBody(settings.apiLogin),
      timeoutMs: settings.timeoutMs,
      correlationId,
    });
    const token = typeof res.body?.token === 'string' ? res.body.token : null;
    if (!token) throw new ExternalServiceError(IIKO_SETTINGS_KEY, 'access_token response has no token', true, res.status);
    this.tokens.set(this.tokenKey(settings), { token, expiresAt: this.clock.now().getTime() + IIKO_TOKEN_TTL_MS });
    return token;
  }

  /** Добавить к ошибке описание из ответа iiko (errorDescription), сохранив классификацию. */
  private withDetails(err: unknown): unknown {
    if (!(err instanceof ExternalServiceError)) return err;
    const description = iikoErrorMessage(err.responseBody);
    if (!description || err.message.includes(description)) return err;
    return new ExternalServiceError(err.integration, `${err.message.replace(/^\[[^\]]+\]\s*/, '')}: ${description}`, err.retryable, err.statusCode, err.responseBody);
  }
}
