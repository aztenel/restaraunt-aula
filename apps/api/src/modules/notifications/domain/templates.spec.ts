import { describe, expect, it } from 'vitest';
import { allDefaultTemplateTexts, defaultTemplateText } from './default-templates';
import { renderText, unknownVariables, usedVariables } from './render';
import { AUDIENCE_CHANNELS, allTemplates, GUEST_TEMPLATE_KEYS, REQUIRED_TEMPLATE_LOCALES, STAFF_TEMPLATE_KEYS, TEMPLATE_KEYS, templateInfo } from './templates';

describe('notification templates', () => {
  it('registry covers every template key of the contract', () => {
    expect(GUEST_TEMPLATE_KEYS).toHaveLength(21);
    expect(STAFF_TEMPLATE_KEYS).toHaveLength(10);
    expect(new Set(TEMPLATE_KEYS).size).toBe(TEMPLATE_KEYS.length);
    for (const info of allTemplates()) {
      expect(info.params.length, info.key).toBeGreaterThan(0);
      for (const p of info.params) expect(info.sample[p], `${info.key}.${p}`).toMatch(/\S/);
      for (const s of info.sensitive) expect(info.params, info.key).toContain(s);
    }
    expect(templateInfo('otp.code')!.sensitive).toEqual(['code']);
    expect(templateInfo('certificate.issued')!.sensitive).toEqual(['code']);
    expect(templateInfo('otp.code')!.ttlMinutes).toBeLessThanOrEqual(15);
    for (const info of allTemplates()) for (const o of info.optional) expect(info.params, info.key).toContain(o);
    expect(templateInfo('certificate.issued')!.optional).toEqual(['pdfUrl']);
  });

  it('optional parameters: a text line with an empty optional parameter and only its label disappears', () => {
    for (const info of allTemplates()) {
      const withoutOptional = Object.fromEntries(Object.entries(info.sample).filter(([k]) => !info.optional.includes(k)));
      for (const channel of info.channels) {
        for (const locale of REQUIRED_TEMPLATE_LOCALES) {
          const text = renderText(defaultTemplateText(info.key, channel, locale)!.body, withoutOptional);
          expect(text, `${info.key}/${channel}/${locale}`).not.toMatch(/\{\{|:\s*$|:\n/);
        }
      }
    }
  });

  it('certificate.issued: WhatsApp carries the PDF link when it is given (email has the PDF attached)', () => {
    const info = templateInfo('certificate.issued')!;
    for (const locale of REQUIRED_TEMPLATE_LOCALES) {
      const body = defaultTemplateText('certificate.issued', 'whatsapp', locale)!.body;
      const withLink = renderText(body, info.sample);
      expect(withLink.split('\n').at(-1)).toBe('Сертификат (PDF): https://files.aula.kz/c/K7PQ.pdf');
      const { pdfUrl: _omit, ...rest } = info.sample;
      const withoutLink = renderText(body, rest);
      expect(withoutLink).not.toContain('PDF');
      expect(withoutLink).toContain('K7PQ-4MXZ-9TWA');
    }
    expect(usedVariables(defaultTemplateText('certificate.issued', 'email', 'ru')!.body)).not.toContain('pdfUrl');
  });

  it('every key x channel x locale (ru, kk) has a default text; email has a subject', () => {
    for (const info of allTemplates()) {
      for (const channel of AUDIENCE_CHANNELS[info.audience]) {
        for (const locale of REQUIRED_TEMPLATE_LOCALES) {
          const text = defaultTemplateText(info.key, channel, locale);
          expect(text, `${info.key}/${channel}/${locale}`).not.toBeNull();
          expect(text!.body.trim().length, `${info.key}/${channel}/${locale}`).toBeGreaterThan(10);
          if (channel === 'email') expect(text!.subject?.trim(), `${info.key}/${channel}/${locale} subject`).toBeTruthy();
        }
      }
    }
  });

  it('default texts use only declared parameters and only supported channels', () => {
    for (const { key, channel, locale, text } of allDefaultTemplateTexts()) {
      const info = templateInfo(key);
      expect(info, key).toBeDefined();
      expect(info!.channels, `${key}: channel ${channel}`).toContain(channel);
      expect(unknownVariables(text.body, info!.params), `${key}/${channel}/${locale}`).toEqual([]);
      if (text.subject) expect(unknownVariables(text.subject, info!.params), `${key}/${channel}/${locale} subject`).toEqual([]);
    }
  });

  it('every declared parameter is shown in at least one text of the template', () => {
    for (const info of allTemplates()) {
      const used = new Set<string>();
      for (const channel of info.channels) {
        for (const locale of REQUIRED_TEMPLATE_LOCALES) {
          const text = defaultTemplateText(info.key, channel, locale)!;
          for (const v of [...usedVariables(text.body), ...usedVariables(text.subject ?? '')]) used.add(v);
        }
      }
      expect(info.params.filter((p) => !used.has(p)), info.key).toEqual([]);
    }
  });

  it('ru and kk texts of a channel use the same parameters (translations are complete)', () => {
    for (const info of allTemplates()) {
      for (const channel of info.channels) {
        const ru = defaultTemplateText(info.key, channel, 'ru')!;
        const kk = defaultTemplateText(info.key, channel, 'kk')!;
        expect(usedVariables(kk.body).sort(), `${info.key}/${channel}`).toEqual(usedVariables(ru.body).sort());
      }
    }
  });

  it('texts fit channel limits with sample parameters (SMS up to 160 characters)', () => {
    for (const info of allTemplates()) {
      for (const locale of REQUIRED_TEMPLATE_LOCALES) {
        for (const channel of info.channels) {
          const text = renderText(defaultTemplateText(info.key, channel, locale)!.body, info.sample);
          const limit = channel === 'sms' ? 160 : channel === 'whatsapp' ? 1024 : 4096;
          expect(text.length, `${info.key}/${channel}/${locale}: ${text}`).toBeLessThanOrEqual(limit);
          expect(text).not.toMatch(/\{\{/);
        }
      }
    }
  });
});
