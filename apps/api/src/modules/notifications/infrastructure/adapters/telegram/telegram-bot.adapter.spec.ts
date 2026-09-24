import { describe, expect, it } from 'vitest';
import { FakeHttpTransport } from '../../../../../../test/fakes';
import { ChannelNotConfiguredError } from '../../../application/channel-adapter';
import { externalHttpStub, sendRequest, settingsStub, storageStub } from '../../../testing/adapter-stubs';
import { TelegramBotAdapter } from './telegram-bot.adapter';

const TOKEN = '123456:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

function telegram(config: Record<string, unknown> | null, transport: FakeHttpTransport) {
  const { http } = externalHttpStub(transport);
  return new TelegramBotAdapter(settingsStub({ 'notifications.telegram': config }), http, storageStub());
}

describe('TelegramBotAdapter', () => {
  it('sends text with sendMessage and attachments with sendDocument (signed link)', async () => {
    const transport = new FakeHttpTransport().on('/sendMessage', 200, { ok: true, result: { message_id: 10 } }).on('/sendDocument', 200, { ok: true, result: { message_id: 11 } });
    const tg = telegram({ botToken: TOKEN }, transport);
    const result = await tg.send(
      sendRequest({
        channel: 'telegram',
        to: '-100200',
        content: { subject: null, text: 'Новый заказ', html: null },
        attachments: [{ fileKey: 'reports/d.xlsx', filename: 'report.xlsx', contentType: 'application/vnd.ms-excel' }],
      }),
    );
    expect(result).toEqual({ provider: 'telegram', externalId: '-100200:10' });
    expect(transport.requests.map((r) => r.url)).toEqual([
      `https://api.telegram.org/bot${TOKEN}/sendMessage`,
      `https://api.telegram.org/bot${TOKEN}/sendDocument`,
    ]);
    expect(JSON.parse(transport.requests[1]!.body!)).toEqual({
      chat_id: '-100200',
      document: 'https://files.test/private/reports/d.xlsx?ttl=86400',
      caption: 'report.xlsx',
    });
  });

  it('bot blocked (403) is permanent, flood limit (429) is temporary; invalid token is not configured', async () => {
    const blocked = new FakeHttpTransport().on('api.telegram.org', 403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked' });
    await expect(telegram({ botToken: TOKEN }, blocked).send(sendRequest({ channel: 'telegram', to: '1' }))).rejects.toMatchObject({ retryable: false });
    const flood = new FakeHttpTransport().on('api.telegram.org', 429, { ok: false, error_code: 429, parameters: { retry_after: 5 } });
    await expect(telegram({ botToken: TOKEN }, flood).send(sendRequest({ channel: 'telegram', to: '1' }))).rejects.toMatchObject({ retryable: true });
    const notOk = new FakeHttpTransport().on('api.telegram.org', 200, { ok: false, description: 'chat not found' });
    await expect(telegram({ botToken: TOKEN }, notOk).send(sendRequest({ channel: 'telegram', to: '1' }))).rejects.toMatchObject({ retryable: false });
    await expect(telegram({ botToken: 'bad' }, new FakeHttpTransport()).send(sendRequest())).rejects.toBeInstanceOf(ChannelNotConfiguredError);
    await expect(telegram(null, new FakeHttpTransport()).send(sendRequest())).rejects.toBeInstanceOf(ChannelNotConfiguredError);
  });
});
