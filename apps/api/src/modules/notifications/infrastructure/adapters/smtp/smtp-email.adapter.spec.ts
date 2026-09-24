import { describe, expect, it } from 'vitest';
import { IntegrationLogEntry } from '../../../../../shared/infrastructure/integrations/integration-log';
import { ChannelNotConfiguredError } from '../../../application/channel-adapter';
import { sendRequest, settingsStub, storageStub } from '../../../testing/adapter-stubs';
import { RedactingIntegrationLog } from '../../redaction';
import { classifySmtpError, SmtpEmailAdapter, SmtpMail, SmtpSettings, SmtpTransport, SmtpTransportFactory } from './smtp-email.adapter';

function setup(config: Record<string, unknown> | null, behaviour: (mail: SmtpMail) => Promise<{ messageId?: string; accepted?: unknown[]; rejected?: unknown[] }>) {
  const mails: SmtpMail[] = [];
  const created: SmtpSettings[] = [];
  const factory = {
    create: (settings: SmtpSettings): SmtpTransport => {
      created.push(settings);
      return { sendMail: async (mail) => (mails.push(mail), behaviour(mail)) };
    },
  } as SmtpTransportFactory;
  const logs: IntegrationLogEntry[] = [];
  const log = { record: async (e: IntegrationLogEntry) => void logs.push(e) } as unknown as RedactingIntegrationLog;
  const adapter = new SmtpEmailAdapter(
    settingsStub({ 'notifications.smtp': config }),
    factory,
    storageStub({ 'docs/a.pdf': Buffer.from('PDF') }),
    log,
  );
  return { adapter, mails, created, logs };
}

const config = { host: 'smtp.test', from: 'AULA <noreply@aula.kz>', user: 'u', password: 'p', replyTo: 'hello@aula.kz' };
const email = sendRequest({
  channel: 'email',
  to: 'guest@mail.kz',
  content: { subject: 'Счёт', text: 'Текст', html: '<p>Текст</p>' },
  attachments: [{ fileKey: 'docs/a.pdf', filename: 'Счёт.pdf', contentType: 'application/pdf' }],
});

describe('SmtpEmailAdapter', () => {
  it('sends a mail with attachments loaded from private storage and reuses the transport', async () => {
    const { adapter, mails, created, logs } = setup(config, async () => ({ messageId: '<1@aula>', accepted: ['guest@mail.kz'], rejected: [] }));
    expect(await adapter.send(email)).toEqual({ provider: 'smtp', externalId: '<1@aula>' });
    await adapter.send(email);
    expect(created).toHaveLength(1);
    expect(mails[0]).toMatchObject({
      from: 'AULA <noreply@aula.kz>',
      to: 'guest@mail.kz',
      replyTo: 'hello@aula.kz',
      subject: 'Счёт',
      text: 'Текст',
      html: '<p>Текст</p>',
      attachments: [{ filename: 'Счёт.pdf', contentType: 'application/pdf', content: Buffer.from('PDF') }],
      headers: { 'X-AULA-Delivery': 'd-1' },
    });
    expect(logs[0]).toMatchObject({ integration: 'notifications.smtp', operation: 'sendMail', success: true });
    expect((logs[0]!.request as { to: string }).to).toBe('gu***@mail.kz');
  });

  it('rejected recipient is a permanent error; SMTP errors are classified', async () => {
    const { adapter } = setup(config, async () => ({ accepted: [], rejected: ['guest@mail.kz'] }));
    await expect(adapter.send(email)).rejects.toMatchObject({ retryable: false });
    expect(classifySmtpError({ code: 'ECONNECTION', message: 'refused' }).retryable).toBe(true);
    expect(classifySmtpError({ code: 'EAUTH', message: 'auth' }).retryable).toBe(false);
    expect(classifySmtpError({ responseCode: 451, message: 'try later' }).retryable).toBe(true);
    expect(classifySmtpError({ responseCode: 550, message: 'no mailbox' }).retryable).toBe(false);
    const failing = setup(config, async () => {
      throw Object.assign(new Error('Greeting never received'), { code: 'ETIMEDOUT' });
    });
    await expect(failing.adapter.send(email)).rejects.toMatchObject({ retryable: true });
    expect(failing.logs[0]).toMatchObject({ success: false });
  });

  it('is not configured without settings', async () => {
    const { adapter } = setup(null, async () => ({}));
    expect(await adapter.isConfigured()).toBe(false);
    await expect(adapter.send(email)).rejects.toBeInstanceOf(ChannelNotConfiguredError);
    const invalid = setup({ host: 'x' }, async () => ({}));
    expect(await invalid.adapter.isConfigured()).toBe(false);
  });
});
