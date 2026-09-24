import { describe, expect, it } from 'vitest';
import { FakeHttpTransport } from '../../../../../../test/fakes';
import { ExternalServiceError } from '../../../../../shared/infrastructure/integrations/external-http';
import { ChannelNotConfiguredError } from '../../../application/channel-adapter';
import { externalHttpStub, sendRequest, settingsStub } from '../../../testing/adapter-stubs';
import { MobizonSmsProvider } from '../mobizon/mobizon.sms-provider';
import { SmscSmsProvider } from '../smsc/smsc.sms-provider';
import { routeSmsProviders, SmsChannel } from './sms-channel';

function channel(values: Record<string, Record<string, unknown> | null>, transport: FakeHttpTransport) {
  const settings = settingsStub(values);
  const { http, logs } = externalHttpStub(transport);
  return { sms: new SmsChannel([new MobizonSmsProvider(settings, http), new SmscSmsProvider(settings, http)], settings), logs };
}

const mobizon = { 'notifications.mobizon': { apiKey: 'mobizon-key-123', from: 'AULA' } };
const smsc = { 'notifications.smsc': { login: 'aula', password: 'pwd', sender: 'AULA' } };
const request = sendRequest({ channel: 'sms', content: { subject: null, text: 'AULA: код 1234', html: null } });

describe('SMS routing', () => {
  it('orders gateways by settings and prefix rules (longest prefix wins)', () => {
    expect(routeSmsProviders('+77011234567', ['mobizon', 'smsc'], null)).toEqual(['mobizon', 'smsc']);
    expect(routeSmsProviders('+77011234567', ['mobizon', 'smsc'], { order: ['smsc', 'mobizon'] })).toEqual(['smsc', 'mobizon']);
    expect(routeSmsProviders('+77011234567', ['mobizon'], { order: ['smsc', 'mobizon'] })).toEqual(['mobizon']);
    const rules = { prefixRules: [{ prefix: '+7701', provider: 'smsc' }, { prefix: '77011', provider: 'mobizon' }] };
    expect(routeSmsProviders('+77011234567', ['mobizon', 'smsc'], { order: ['smsc', 'mobizon'], ...rules })).toEqual(['mobizon', 'smsc']);
    expect(routeSmsProviders('+77021234567', ['mobizon', 'smsc'], rules)).toEqual(['mobizon', 'smsc']);
    expect(routeSmsProviders('+77019234567', ['mobizon', 'smsc'], rules)).toEqual(['smsc', 'mobizon']);
  });
});

describe('SmsChannel', () => {
  it('is not configured without gateways', async () => {
    const { sms } = channel({}, new FakeHttpTransport());
    expect(await sms.isConfigured()).toBe(false);
    await expect(sms.send(request)).rejects.toBeInstanceOf(ChannelNotConfiguredError);
  });

  it('sends through Mobizon (form body, key in the query string)', async () => {
    const transport = new FakeHttpTransport().on('api.mobizon.kz', 200, { code: 0, data: { messageId: 99 } });
    const { sms } = channel(mobizon, transport);
    expect(await sms.send(request)).toEqual({ provider: 'mobizon', externalId: '99' });
    const [req] = transport.requests;
    expect(req!.url).toBe('https://api.mobizon.kz/service/message/sendsmsmessage?output=json&api=v1&apiKey=mobizon-key-123');
    expect(Object.fromEntries(new URLSearchParams(req!.body))).toEqual({ recipient: '77011234567', text: 'AULA: код 1234', from: 'AULA' });
    expect(req!.headers['content-type']).toBe('application/x-www-form-urlencoded');
  });

  it('sends through SMSC.kz and classifies its error codes', async () => {
    const ok = new FakeHttpTransport().on('smsc.kz', 200, { id: 5, cnt: 1 });
    expect(await channel(smsc, ok).sms.send(request)).toEqual({ provider: 'smsc', externalId: '5' });
    expect(Object.fromEntries(new URLSearchParams(ok.requests[0]!.body))).toMatchObject({
      login: 'aula',
      psw: 'pwd',
      phones: '77011234567',
      mes: 'AULA: код 1234',
      fmt: '3',
      charset: 'utf-8',
      sender: 'AULA',
    });

    const blocked = new FakeHttpTransport().on('smsc.kz', 200, { error: 'IP blocked', error_code: 4 });
    await expect(channel(smsc, blocked).sms.send(request)).rejects.toMatchObject({ retryable: true });
    const badPhone = new FakeHttpTransport().on('smsc.kz', 200, { error: 'invalid phone', error_code: 7 });
    await expect(channel(smsc, badPhone).sms.send(request)).rejects.toMatchObject({ retryable: false });
  });

  it('fails over to the next gateway; all failures -> retryable if any was temporary', async () => {
    const transport = new FakeHttpTransport()
      .on('api.mobizon.kz', 200, { code: 8, message: 'Недостаточно средств' })
      .on('smsc.kz', 200, { id: 7, cnt: 1 });
    expect(await channel({ ...mobizon, ...smsc }, transport).sms.send(request)).toEqual({ provider: 'smsc', externalId: '7' });

    const down = new FakeHttpTransport().on('api.mobizon.kz', 502, 'Bad gateway').on('smsc.kz', 200, { error: 'bad', error_code: 7 });
    const err = await channel({ ...mobizon, ...smsc }, down)
      .sms.send(request)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExternalServiceError);
    expect((err as ExternalServiceError).retryable).toBe(true);

    const permanent = new FakeHttpTransport().on('api.mobizon.kz', 200, { code: 1, message: 'validation' });
    await expect(channel(mobizon, permanent).sms.send(request)).rejects.toMatchObject({ retryable: false });
  });
});
