import { Injectable } from '@nestjs/common';
import { Actor } from '../../../shared/kernel/actor';
import { Locale, translate, Translatable } from '../../../shared/kernel/translatable';
import { Permission } from '../../../shared/kernel/permissions';
import { missingTranslations, REQUIRED_LOCALES, TranslatableField } from '../domain/translations';
import { CategoryRepository } from '../infrastructure/category.repository';
import { BannerRepository, PageRepository, PromotionRepository } from '../infrastructure/content.repository';
import { DishRepository } from '../infrastructure/dish.repository';
import { ModifierRepository } from '../infrastructure/modifier.repository';
import { assertAnySomewhere } from './catalog-admin.queries';

export const TRANSLATION_ENTITY_TYPES = ['category', 'dish', 'modifier_group', 'modifier_option', 'banner', 'promotion', 'page'] as const;
export type TranslationEntityType = (typeof TRANSLATION_ENTITY_TYPES)[number];

export interface TranslationGap {
  entityType: TranslationEntityType;
  entityId: string;
  /** Подпись для админки (название на любом доступном языке). */
  label: string;
  field: string;
  missing: Locale[];
  /** Для опции модификатора — её группа (ссылка на редактор группы); иначе null. */
  groupId: string | null;
}

export interface TranslationSummary {
  entityType: TranslationEntityType;
  total: number;
  incomplete: number;
}

export interface TranslationReport {
  locales: Locale[];
  summary: TranslationSummary[];
  items: TranslationGap[];
}

/**
 * Отчёт о полноте переводов (решение №10): какие сущности меню и контента не переведены
 * на kk или ru (и en, если запрошен). Витрина при этом показывает запасной язык.
 */
@Injectable()
export class TranslationReportQuery {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly dishes: DishRepository,
    private readonly modifiers: ModifierRepository,
    private readonly banners: BannerRepository,
    private readonly promotions: PromotionRepository,
    private readonly pages: PageRepository,
  ) {}

  async execute(actor: Actor, options: { locales?: Locale[] | null; entityType?: TranslationEntityType | null } = {}): Promise<TranslationReport> {
    assertAnySomewhere(actor, [Permission.MenuContent, Permission.ContentManage]);
    const locales = options.locales && options.locales.length > 0 ? [...new Set(options.locales)] : [...REQUIRED_LOCALES];
    const entities: Array<{
      entityType: TranslationEntityType;
      entityId: string;
      name: Translatable;
      fields: TranslatableField[];
      groupId?: string;
    }> = [];
    const want = (t: TranslationEntityType) => !options.entityType || options.entityType === t;

    if (want('category')) {
      for (const c of await this.categories.list()) {
        entities.push({
          entityType: 'category',
          entityId: c.id,
          name: c.name,
          fields: [
            { field: 'name', value: c.name, required: true },
            { field: 'description', value: c.description, required: false },
            { field: 'seoTitle', value: c.seoTitle, required: false },
            { field: 'seoDescription', value: c.seoDescription, required: false },
          ],
        });
      }
    }
    if (want('dish')) {
      for (const d of await this.dishes.listAll()) {
        entities.push({
          entityType: 'dish',
          entityId: d.id,
          name: d.name,
          fields: [
            { field: 'name', value: d.name, required: true },
            { field: 'description', value: d.description, required: false },
            { field: 'composition', value: d.composition, required: false },
            { field: 'seoTitle', value: d.seoTitle, required: false },
            { field: 'seoDescription', value: d.seoDescription, required: false },
          ],
        });
      }
    }
    if (want('modifier_group') || want('modifier_option')) {
      for (const g of await this.modifiers.list()) {
        if (want('modifier_group')) {
          entities.push({
            entityType: 'modifier_group',
            entityId: g.id,
            name: g.name,
            fields: [
              { field: 'name', value: g.name, required: true },
              { field: 'description', value: g.description, required: false },
            ],
          });
        }
        if (want('modifier_option')) {
          for (const o of g.options) {
            entities.push({
              entityType: 'modifier_option',
              entityId: o.id,
              name: o.name,
              fields: [{ field: 'name', value: o.name, required: true }],
              groupId: g.id,
            });
          }
        }
      }
    }
    if (want('banner')) {
      for (const b of await this.banners.list()) {
        entities.push({
          entityType: 'banner',
          entityId: b.id,
          name: b.title,
          fields: [
            { field: 'title', value: b.title, required: true },
            { field: 'subtitle', value: b.subtitle, required: false },
            { field: 'ctaLabel', value: b.ctaLabel, required: false },
          ],
        });
      }
    }
    if (want('promotion')) {
      for (const p of await this.promotions.list()) {
        entities.push({
          entityType: 'promotion',
          entityId: p.id,
          name: p.title,
          fields: [
            { field: 'title', value: p.title, required: true },
            { field: 'description', value: p.description, required: false },
            { field: 'terms', value: p.terms, required: false },
            { field: 'seoTitle', value: p.seoTitle, required: false },
            { field: 'seoDescription', value: p.seoDescription, required: false },
          ],
        });
      }
    }
    if (want('page')) {
      for (const p of await this.pages.list()) {
        entities.push({
          entityType: 'page',
          entityId: p.id,
          name: p.title,
          fields: [
            { field: 'title', value: p.title, required: true },
            { field: 'body', value: p.body, required: true },
            { field: 'seoTitle', value: p.seoTitle, required: false },
            { field: 'seoDescription', value: p.seoDescription, required: false },
          ],
        });
      }
    }

    const items: TranslationGap[] = [];
    const summary = new Map<TranslationEntityType, TranslationSummary>();
    for (const e of entities) {
      const s = summary.get(e.entityType) ?? { entityType: e.entityType, total: 0, incomplete: 0 };
      s.total++;
      const gaps = missingTranslations(e.fields, locales);
      if (gaps.length > 0) s.incomplete++;
      summary.set(e.entityType, s);
      const label = translate(e.name, 'ru');
      for (const gap of gaps) {
        items.push({ entityType: e.entityType, entityId: e.entityId, label, field: gap.field, missing: gap.missing, groupId: e.groupId ?? null });
      }
    }
    return {
      locales,
      summary: TRANSLATION_ENTITY_TYPES.filter((t) => want(t)).map((t) => summary.get(t) ?? { entityType: t, total: 0, incomplete: 0 }),
      items,
    };
  }
}
