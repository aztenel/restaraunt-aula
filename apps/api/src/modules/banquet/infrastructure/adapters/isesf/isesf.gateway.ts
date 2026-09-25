import { Injectable } from '@nestjs/common';
import { ZodType } from 'zod';
import { ExternalHttp, ExternalServiceError } from '../../../../../shared/infrastructure/integrations/external-http';
import { IntegrationSettings } from '../../../../../shared/infrastructure/settings/integration-settings';
import { ValidationError } from '../../../../../shared/kernel/errors';
import { EsfGateway, EsfInvoiceData, EsfStatusResult, EsfSubmitResult } from '../../../domain/esf';
import { buildEsfXml, escapeXml, findNode, parseXml } from '../esf-xml';
import { ISESF_PROVIDER, ISESF_SETTINGS_KEY, IsEsfSettings, IsEsfSettingsSchema } from './isesf.settings';

const SOAP_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const WSSE_NS = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd';

/** Статусы ЭСФ в ИС ЭСФ, означающие отказ. */
const FAILED_STATUSES = ['DECLINED', 'FAILED', 'CANCELED', 'CANCELLED', 'REVOKED', 'DELETED'];

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim() || null;
  return null;
}

function envelope(body: string, header = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="${SOAP_NS}" xmlns:esf="esf"><soapenv:Header>${header}</soapenv:Header><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;
}

/**
 * Адаптер ИС ЭСФ (этап 3): ЭСФ подписывается ключом ЭЦП через NCANode (HTTP), затем через SOAP API
 * создаётся сессия, загружается подписанный ЭСФ (syncInvoice), запрашивается регистрационный номер,
 * сессия закрывается. Все адреса настраиваются. Вызывается только из фоновых задач.
 * Сетевые ошибки и 5xx — повтор (ExternalServiceError retryable); отказ ИС ЭСФ в приёме — без повтора.
 */
@Injectable()
export class IsEsfGateway extends EsfGateway {
  readonly provider = ISESF_PROVIDER;

  constructor(
    private readonly settings: IntegrationSettings,
    private readonly http: ExternalHttp,
  ) {
    super();
  }

  async isEnabled(): Promise<boolean> {
    return this.settings.isEnabled(ISESF_SETTINGS_KEY);
  }

  private async config(): Promise<IsEsfSettings> {
    // Схема со значениями по умолчанию: вход и выход различаются, get() типизирован по выходу.
    const config = await this.settings.get(ISESF_SETTINGS_KEY, IsEsfSettingsSchema as unknown as ZodType<IsEsfSettings>);
    if (!config) throw new ValidationError('banquet_esf.not_configured', 'ESF API integration is not configured');
    return config;
  }

  async submit(invoice: EsfInvoiceData, ctx: { correlationId: string }): Promise<EsfSubmitResult> {
    const config = await this.config();
    const xml = buildEsfXml(invoice, config);
    const signature = await this.sign(config, xml, ctx.correlationId);
    const sessionId = await this.createSession(config, ctx.correlationId);
    try {
      const esfId = await this.upload(config, sessionId, xml, signature, ctx.correlationId);
      const info = await this.query(config, sessionId, esfId, ctx.correlationId);
      return { outcome: 'submitted', xml, esfId, registrationNumber: info.registrationNumber };
    } finally {
      await this.closeSession(config, sessionId, ctx.correlationId);
    }
  }

  override async checkStatus(esfId: string, ctx: { correlationId: string }): Promise<EsfStatusResult> {
    const config = await this.config();
    const sessionId = await this.createSession(config, ctx.correlationId);
    try {
      const info = await this.query(config, sessionId, esfId, ctx.correlationId);
      if (info.status && FAILED_STATUSES.includes(info.status.toUpperCase())) {
        return { status: 'failed', registrationNumber: info.registrationNumber, error: info.reason ?? info.status };
      }
      if (info.registrationNumber) return { status: 'registered', registrationNumber: info.registrationNumber, error: null };
      return { status: 'sent', registrationNumber: null, error: null };
    } finally {
      await this.closeSession(config, sessionId, ctx.correlationId);
    }
  }

  /** Подпись XML ЭСФ ключом ЭЦП через NCANode (открепленная CMS-подпись в base64). */
  private async sign(config: IsEsfSettings, xml: string, correlationId: string): Promise<string> {
    const res = await this.http.request<Record<string, unknown>>({
      integration: ISESF_SETTINGS_KEY,
      operation: 'ncanode.sign',
      method: 'POST',
      url: `${config.ncanodeUrl}${config.ncanodeSignPath}`,
      body: {
        data: Buffer.from(xml, 'utf8').toString('base64'),
        signers: [{ key: config.signKey, password: config.signKeyPassword, keyAlias: null }],
        withTsp: true,
        detached: true,
      },
      timeoutMs: config.timeoutMs,
      correlationId,
    });
    const body = typeof res.body === 'object' && res.body !== null ? res.body : {};
    const signature = text(body.cms) ?? text(body.signature);
    if (!signature) {
      throw new ExternalServiceError(ISESF_SETTINGS_KEY, `NCANode did not return a signature: ${text(body.message) ?? 'empty response'}`, false, res.status, body);
    }
    return signature;
  }

  private async soap(config: IsEsfSettings, operation: string, path: string, body: string, correlationId: string, header = ''): Promise<unknown> {
    try {
      const res = await this.http.request({
        integration: ISESF_SETTINGS_KEY,
        operation,
        method: 'POST',
        url: `${config.baseUrl}${path}`,
        headers: { 'content-type': 'text/xml; charset=utf-8', accept: 'text/xml', soapaction: '""' },
        body: envelope(body, header),
        timeoutMs: config.timeoutMs,
        correlationId,
      });
      return parseXml(res.rawText);
    } catch (err) {
      // SOAP Fault с ошибкой клиента (неверные данные, авторизация) — повтор бессмыслен.
      if (err instanceof ExternalServiceError && typeof err.responseBody === 'string' && err.responseBody.includes('Fault')) {
        const tree = parseXml(err.responseBody);
        const code = text(findNode(tree, 'faultcode')) ?? '';
        const message = text(findNode(tree, 'faultstring')) ?? err.message;
        if (/client|auth|validation|invalid|denied/i.test(`${code} ${message}`)) {
          throw new ExternalServiceError(ISESF_SETTINGS_KEY, `${operation}: ${message}`, false, err.statusCode, err.responseBody);
        }
      }
      throw err;
    }
  }

  private async createSession(config: IsEsfSettings, correlationId: string): Promise<string> {
    const header =
      `<wsse:Security xmlns:wsse="${WSSE_NS}"><wsse:UsernameToken>` +
      `<wsse:Username>${escapeXml(config.username)}</wsse:Username><wsse:Password>${escapeXml(config.password)}</wsse:Password>` +
      `</wsse:UsernameToken></wsse:Security>`;
    const tree = await this.soap(
      config,
      'createSession',
      config.sessionPath,
      `<esf:createSessionRequest><tin>${escapeXml(config.tin)}</tin><x509Certificate>${escapeXml(config.authCertificate)}</x509Certificate></esf:createSessionRequest>`,
      correlationId,
      header,
    );
    const sessionId = text(findNode(tree, 'sessionId'));
    if (!sessionId) throw new ExternalServiceError(ISESF_SETTINGS_KEY, 'createSession: no sessionId in response', true);
    return sessionId;
  }

  private async closeSession(config: IsEsfSettings, sessionId: string, correlationId: string): Promise<void> {
    try {
      await this.soap(config, 'closeSession', config.sessionPath, `<esf:closeSessionRequest><sessionId>${escapeXml(sessionId)}</sessionId></esf:closeSessionRequest>`, correlationId);
    } catch {
      // Сессия истечёт сама; ошибка закрытия не влияет на результат отправки.
    }
  }

  private async upload(config: IsEsfSettings, sessionId: string, xml: string, signature: string, correlationId: string): Promise<string> {
    const body =
      `<esf:syncInvoiceRequest><sessionId>${escapeXml(sessionId)}</sessionId><invoiceUploadInfoList><invoiceUploadInfo>` +
      `<invoiceBody><![CDATA[${xml.replace(/]]>/g, ']]]]><![CDATA[>')}]]></invoiceBody><version>InvoiceV2</version>` +
      `<signature>${escapeXml(signature)}</signature><signatureType>COMPANY</signatureType>` +
      `</invoiceUploadInfo></invoiceUploadInfoList><x509Certificate>${escapeXml(config.signCertificate)}</x509Certificate></esf:syncInvoiceRequest>`;
    const tree = await this.soap(config, 'syncInvoice', config.uploadPath, body, correlationId);
    const accepted = findNode(tree, 'acceptedSet');
    const esfId = text(findNode(accepted, 'id'));
    if (esfId) return esfId;
    const declined = findNode(tree, 'declinedSet');
    const reason = text(findNode(declined, 'text')) ?? text(findNode(declined, 'errorCode')) ?? 'invoice was declined';
    throw new ExternalServiceError(ISESF_SETTINGS_KEY, `syncInvoice: ${reason}`, false, null, tree);
  }

  private async query(
    config: IsEsfSettings,
    sessionId: string,
    esfId: string,
    correlationId: string,
  ): Promise<{ registrationNumber: string | null; status: string | null; reason: string | null }> {
    const tree = await this.soap(
      config,
      'queryInvoiceById',
      config.invoicePath,
      `<esf:queryInvoiceByIdRequest><sessionId>${escapeXml(sessionId)}</sessionId><idList><id>${escapeXml(esfId)}</id></idList></esf:queryInvoiceByIdRequest>`,
      correlationId,
    );
    const info = findNode(tree, 'invoiceInfo');
    return {
      registrationNumber: text(findNode(info, 'registrationNumber')),
      status: text(findNode(info, 'invoiceStatus')),
      reason: text(findNode(info, 'cancelReason')) ?? text(findNode(info, 'statusReason')),
    };
  }
}
