import { describe, expect, it } from 'vitest';
import { htmlToPlainText, sanitizePageHtml, sanitizeTranslatableHtml } from './html';

describe('page html sanitizer', () => {
  it('removes scripts, handlers, iframes and unsafe links', () => {
    const dirty =
      '<h2 onclick="x()">Доставка</h2><script>alert(1)</script><p style="color:red">Текст <a href="javascript:alert(1)">ссылка</a></p><iframe src="https://x"></iframe>';
    expect(sanitizePageHtml(dirty)).toBe('<h2>Доставка</h2><p>Текст <a>ссылка</a></p>');
  });

  it('keeps allowed markup, adds rel for target=_blank', () => {
    const html = '<ul><li><strong>QR</strong></li></ul><a href="https://aula.kz" target="_blank">сайт</a><a href="tel:+77172000000">тел</a>';
    const clean = sanitizePageHtml(html);
    expect(clean).toContain('<ul><li><strong>');
    expect(clean).toContain('rel="noopener noreferrer"');
    expect(clean).toContain('href="tel:+77172000000"');
  });

  it('sanitizes translatable html and drops empty locales', () => {
    expect(sanitizeTranslatableHtml({ ru: '<p>Да</p>', kk: '<script>x</script>' })).toEqual({ ru: '<p>Да</p>' });
    expect(htmlToPlainText('<h2>Оферта</h2><p>Текст&nbsp;договора &amp; условия</p>')).toBe('ОфертаТекст договора & условия');
  });
});
