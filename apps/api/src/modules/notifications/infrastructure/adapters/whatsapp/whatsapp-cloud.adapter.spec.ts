import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeHttpTransport } from '../../../../../../test/fakes';
import { ExternalServiceError } from '../../../../../shared/infrastructure/integrations/external-http';
import { ChannelNotConfiguredError } from '../../../application/channel-adapter';
import { externalHttpStub, sendRequest, settingsStub, storageStub } from '../../../testing/adapter-stubs';
import { parseWhatsAppStatuses, verifyMetaSignature, WhatsAppCloudAdapter, whatsappParamText } from './whatsapp-cloud.adapter';

const base = { phoneNumberId: '555', accessToken: 'token-123', appSecret: 'secret', verifyToken: 'vt' };

function adapter(config: Record<string, unknown> | null, transport = new FakeHttpTransport()) {
  const { http, logs } = externalHttpStub(transport);
  return { adapter: new WhatsAppCloudAdapter(settingsStub({ 'notifications.whatsapp': config }), http, storageStub()), transport, logs };
}

describe('WhatsAppCloudAdapter', () => {
  it('sends an approved template with positional body parameters in contract order', async () => {
    const { adapter: wa, transport } = adapter({ ...base, templates: { 'order.accepted': 'aula_accepted' } });
    transport.on('graph.facebook.com', 200, { messages: [{ id: 'wamid.1' }] });
    const result = await wa.send(sendRequest({ params: { number: 'GL-1', trackingUrl: 'https://t/1', eta: '' } }));
    expect(result).toEqual({ provider: 'whatsapp', externalId: 'wamid.1' });
    const body = JSON.parse(transport.requests[0]!.body!);
    expect(transport.requests[0]!.url).toBe('https://graph.facebook.com/v21.0/555/messages');
    expect(body.template).toEqual({
      name: 'aula_accepted',
      language: { code: 'ru' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'GL-1' }, { type: 'text', text: 'https://t/1' }, { type: 'text', text: '—' }] }],
    });
  });

  it('supports named parameters, custom order, language mapping and fallback to an approved language', async () => {
    const { adapter: wa, transport } = adapter({
      ...base,
      apiVersion: 'v20.0',
      languageCodes: { en: 'en_US' },
      templates: { 'order.accepted': { name: 'aula_accepted', params: ['eta', 'number'], namedParams: true, languages: ['ru'] } },
    });
    transport.on('graph.facebook.com', 200, { messages: [{ id: 'wamid.2' }] });
    await wa.send(sendRequest({ locale: 'kk' }));
    const body = JSON.parse(transport.requests[0]!.body!);
    expect(transport.requests[0]!.url).toContain('/v20.0/555/messages');
    expect(body.template.language).toEqual({ code: 'ru' });
    expect(body.template.components[0].parameters).toEqual([
      { type: 'text', parameter_name: 'eta', text: '19:40' },
      { type: 'text', parameter_name: 'number', text: 'GL-1' },
    ]);
  });

  it('reports unconfigured integration and unmapped template as not configured', async () => {
    await expect(adapter(null).adapter.send(sendRequest())).rejects.toBeInstanceOf(ChannelNotConfiguredError);
    await expect(adapter({ ...base, templates: {} }).adapter.send(sendRequest())).rejects.toBeInstanceOf(ChannelNotConfiguredError);
    await expect(adapter({ phoneNumberId: '' }).adapter.send(sendRequest())).rejects.toBeInstanceOf(ChannelNotConfiguredError);
    expect(await adapter({ phoneNumberId: '' }).adapter.isConfigured()).toBe(false);
    expect(await adapter(base).adapter.configuredProviders()).toEqual(['whatsapp']);
  });

  it('classifies Graph API errors: rate limits and service errors are temporary, template errors are permanent', async () => {
    const cases: Array<[number, unknown, boolean]> = [
      [400, { error: { code: 131016, message: 'Service unavailable' } }, true],
      [400, { error: { code: 130429, message: 'Rate limit hit' } }, true],
      [400, { error: { code: 132001, message: 'Template does not exist' } }, false],
      [400, { error: { code: 131026, message: 'Message undeliverable' } }, false],
      [500, { error: { code: 1, message: 'Unknown' } }, true],
      [401, { error: { code: 190, message: 'Invalid OAuth access token' } }, false],
    ];
    for (const [status, body, retryable] of cases) {
      const { adapter: wa, transport } = adapter({ ...base, templates: { 'order.accepted': 'x' } });
      transport.on('graph.facebook.com', status, body);
      const err = await wa.send(sendRequest()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ExternalServiceError);
      expect((err as ExternalServiceError).retryable, JSON.stringify(body)).toBe(retryable);
    }
  });

  it('sanitizes parameters as required by WhatsApp', () => {
    expect(whatsappParamText('строка\nвторая\t  и     пробелы')).toBe('строка вторая и пробелы');
    expect(whatsappParamText('   ')).toBe('—');
    expect(whatsappParamText(undefined)).toBe('—');
  });

  it('verifies webhook subscription and signatures, parses statuses', async () => {
    const { adapter: wa } = adapter(base);
    expect(await wa.verifySubscription({ 'hub.mode': 'subscribe', 'hub.verify_token': 'vt', 'hub.challenge': 'c1' })).toBe('c1');
    expect(await wa.verifySubscription({ 'hub.mode': 'subscribe', 'hub.verify_token': 'no', 'hub.challenge': 'c1' })).toBeNull();

    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: 'wamid.1', status: 'failed', timestamp: '1790000000', errors: [{ code: 131026, title: 'Undeliverable', error_data: { details: 'Not on WhatsApp' } }] },
                  { id: 'wamid.2', status: 'read', timestamp: '1790000001' },
                  { id: 'wamid.3', status: 'deleted' },
                ],
              },
            },
          ],
        },
      ],
    };
    const raw = Buffer.from(JSON.stringify(body));
    const signature = `sha256=${createHmac('sha256', 'secret').update(raw).digest('hex')}`;
    const updates = await wa.parseStatuses({ headers: { 'x-hub-signature-256': signature }, rawBody: raw, body });
    expect(updates).toEqual([
      { provider: 'whatsapp', externalId: 'wamid.1', status: 'failed', errorCode: '131026', error: 'Undeliverable: Not on WhatsApp', occurredAt: new Date(1790000000_000) },
      { provider: 'whatsapp', externalId: 'wamid.2', status: 'read', errorCode: null, error: null, occurredAt: new Date(1790000001_000) },
    ]);
    await expect(wa.parseStatuses({ headers: { 'x-hub-signature-256': 'sha256=00' }, rawBody: raw, body })).rejects.toMatchObject({
      code: 'webhook.invalid_signature',
    });
    const { adapter: noSecret } = adapter({ phoneNumberId: '1', accessToken: 't' });
    await expect(noSecret.parseStatuses({ headers: {}, body })).rejects.toMatchObject({ code: 'webhook.not_configured' });
  });

  it('accepts Meta-style escaped JSON signatures when the raw body is not available', () => {
    const body = { entry: [{ changes: [{ value: { statuses: [{ id: 'w', status: 'failed', errors: [{ href: 'https://developers.facebook.com/x', title: 'Ошибка' }] }] } }] }] };
    const metaRaw = JSON.stringify(body)
      .replace(/\//g, '\\/')
      .replace(/[\u007f-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
    const signature = `sha256=${createHmac('sha256', 's').update(metaRaw).digest('hex')}`;
    expect(verifyMetaSignature({ headers: { 'x-hub-signature-256': signature }, body }, 's')).toBe(true);
    expect(verifyMetaSignature({ headers: { 'x-hub-signature-256': signature }, body }, 'other')).toBe(false);
    expect(parseWhatsAppStatuses(null)).toEqual([]);
  });
});
