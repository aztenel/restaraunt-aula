import { describe, expect, it } from 'vitest';
import type { Banner, ContentPage } from '@aula/api-client';
import { dayjs } from '@/shared/lib/dates';
import {
  bannerToForm,
  bodyHasText,
  formToBannerInput,
  formToPageInput,
  formToPromotionInput,
  isValidBannerLink,
  isValidWindow,
  pageToForm,
  promotionToForm,
  previewBodyKey,
  sanitizedLocales,
} from './forms';

const banner: Banner = {
  id: 'b1',
  placement: 'menu_top',
  branchId: 'gl',
  title: { ru: 'Комбо-обед', kk: 'Комбо түскі ас' },
  subtitle: {},
  ctaLabel: { ru: 'В меню' },
  linkUrl: '/greenline/menu',
  image: null,
  activeFrom: '2026-09-30T19:00:00.000Z',
  activeTo: null,
  sortOrder: 0,
  isActive: true,
  missingTranslations: [],
  createdAt: '',
  updatedAt: '',
};

describe('баннер: форма ⇄ BannerInput', () => {
  it('окно показа — стенные часы Астаны ⇄ ISO UTC без сдвига', () => {
    const values = bannerToForm(banner);
    // 30.09 19:00 UTC = 01.10 00:00 в Астане
    expect(values.activeFrom?.format('DD.MM.YYYY HH:mm')).toBe('01.10.2026 00:00');
    const input = formToBannerInput(values);
    expect(input.activeFrom).toBe('2026-09-30T19:00:00.000Z');
    expect(input.activeTo).toBeNull();
  });

  it('филиал: null — баннер для всех филиалов; пустая ссылка → null', () => {
    const values = { ...bannerToForm(null), title: { ru: 'Акция' }, linkUrl: '  ' };
    expect(values.branchId).toBeNull();
    const input = formToBannerInput(values);
    expect(input).toMatchObject({ branchId: null, linkUrl: null, placement: 'home_hero', isActive: true, subtitle: {}, ctaLabel: {} });
  });

  it('ссылка — путь сайта или http(s), как на сервере', () => {
    expect(isValidBannerLink('/menu/salaty')).toBe(true);
    expect(isValidBannerLink('https://aula.kz/promo')).toBe(true);
    expect(isValidBannerLink('')).toBe(true);
    expect(isValidBannerLink('//evil.example')).toBe(false);
    expect(isValidBannerLink('javascript:alert(1)')).toBe(false);
    expect(isValidBannerLink('menu')).toBe(false);
  });

  it('окно показа: «по» строго позже «с»', () => {
    expect(isValidWindow(dayjs('2026-10-01T10:00'), dayjs('2026-10-01T10:00'))).toBe(false);
    expect(isValidWindow(dayjs('2026-10-01T10:00'), dayjs('2026-10-02T10:00'))).toBe(true);
    expect(isValidWindow(null, dayjs('2026-10-02T10:00'))).toBe(true);
  });
});

describe('акция: филиалы', () => {
  it('пустой список филиалов — акция всей сети; повторы убираются', () => {
    const values = { ...promotionToForm(null), title: { ru: 'Скидка' }, branchIds: ['gl', 'gl', 'gv'] };
    expect(formToPromotionInput(values).branchIds).toEqual(['gl', 'gv']);
    expect(formToPromotionInput({ ...values, branchIds: [] }).branchIds).toEqual([]);
    expect(formToPromotionInput({ ...values, slug: '' }).slug).toBeNull();
  });
});

describe('страница: HTML по языкам', () => {
  const page: ContentPage = {
    id: 'p1',
    slug: 'offer',
    title: { ru: 'Публичная оферта', kk: 'Жария оферта' },
    body: { ru: '<p>Текст</p>', kk: '<p>Мәтін</p>' },
    seoTitle: {},
    seoDescription: {},
    isPublished: true,
    isProtected: true,
    sortOrder: 0,
    missingTranslations: [],
    createdAt: '',
    updatedAt: '',
  };

  it('пустые языки не отправляются', () => {
    const input = formToPageInput({ ...pageToForm(page), body: { ru: '<p>Новый</p>', kk: '  ', en: '' } });
    expect(input.body).toEqual({ ru: '<p>Новый</p>' });
    expect(input.slug).toBe('offer');
  });

  it('предупреждение, если сервер изменил разметку при очистке', () => {
    expect(sanitizedLocales({ ru: '<p>A</p><script>x</script>', kk: '<p>B</p>' }, { ru: '<p>A</p>', kk: '<p>B</p>' })).toEqual(['ru']);
    expect(sanitizedLocales({ ru: '<p>A</p>' }, { ru: '<p>A</p>' })).toEqual([]);
  });
});

describe('предпросмотр страницы: черновик', () => {
  it('есть ли текст хотя бы на одном языке', () => {
    expect(bodyHasText({})).toBe(false);
    expect(bodyHasText({ ru: '   ', kk: '' })).toBe(false);
    expect(bodyHasText({ kk: '<p>Жеткізу</p>' })).toBe(true);
    expect(bodyHasText(null)).toBe(false);
  });

  it('ключ кэша не зависит от порядка языков и пустых полей', () => {
    expect(previewBodyKey({ ru: 'a', kk: 'b' })).toBe(previewBodyKey({ kk: 'b', ru: 'a', en: ' ' }));
    expect(previewBodyKey({ ru: 'a' })).not.toBe(previewBodyKey({ ru: 'a2' }));
  });
});
