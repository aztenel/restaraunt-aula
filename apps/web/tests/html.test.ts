import { describe, expect, it } from 'vitest';
import { htmlToText, isSafeUrl, stripUnsafeHtml } from '@/lib/html';

describe('HTML страниц из контента (защита в глубину)', () => {
  it('оставляет разметку текста', () => {
    const html = '<h2>Доставка</h2><p>Звоните <a href="tel:+77172000000">по телефону</a> или <a href="/ru/menu">в меню</a>.</p><ul><li>Раз</li></ul>';
    expect(stripUnsafeHtml(html)).toBe(html);
  });

  it('вырезает скрипты, стили, фреймы, формы и обработчики событий', () => {
    const html =
      '<p onclick="alert(1)" style="color:red">Текст</p><script>alert(1)</script><style>p{}</style><iframe src="https://evil"></iframe>' +
      '<img src=x onerror=alert(1)><form action="/x"><input name="a"></form><svg><script>1</script></svg><!-- комментарий -->';
    const out = stripUnsafeHtml(html);
    expect(out).toBe('<p>Текст</p>');
  });

  it('обезвреживает javascript:/data: ссылки, в том числе замаскированные', () => {
    expect(stripUnsafeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a href="#">x</a>');
    expect(stripUnsafeHtml('<a href="  JaVa&#x09;script:alert(1)">x</a>')).toBe('<a href="#">x</a>');
    expect(stripUnsafeHtml("<a href='data:text/html;base64,xx'>x</a>")).toBe('<a href="#">x</a>');
    expect(isSafeUrl('https://aula.kz')).toBe(true);
    expect(isSafeUrl('mailto:info@aula.kz')).toBe(true);
    expect(isSafeUrl('#section')).toBe(true);
    expect(isSafeUrl('//evil.com')).toBe(false);
  });

  it('склеенные теги не собираются в скрипт', () => {
    expect(stripUnsafeHtml('<scr<script>x</script>ipt>alert(1)</script>')).not.toMatch(/<script/i);
  });

  it('новое окно — без доступа к opener', () => {
    expect(stripUnsafeHtml('<a href="https://2gis.kz" target="_blank">карта</a>')).toBe('<a href="https://2gis.kz" target="_blank" rel="noopener noreferrer">карта</a>');
  });

  it('текст без разметки', () => {
    expect(htmlToText('<p>Оплата&nbsp;картой &amp; наличными</p><p>Kaspi</p>')).toBe('Оплата картой & наличными Kaspi');
  });
});
