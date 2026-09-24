import { ValidationError } from '../../../shared/kernel/errors';
import { Translatable } from '../../../shared/kernel/translatable';

/**
 * Справочник аллергенов (14 основных пищевых аллергенов, как в ТР ТС 022/2011 и регламенте ЕС 1169/2011).
 * В БД хранится код; подписи на kk/ru/en отдаёт API. Список синхронизирован с CHECK в миграции.
 */
export const ALLERGENS = {
  gluten: { ru: 'Глютен', kk: 'Глютен', en: 'Gluten' },
  milk: { ru: 'Молоко и лактоза', kk: 'Сүт және лактоза', en: 'Milk' },
  eggs: { ru: 'Яйца', kk: 'Жұмыртқа', en: 'Eggs' },
  nuts: { ru: 'Орехи', kk: 'Жаңғақтар', en: 'Tree nuts' },
  peanuts: { ru: 'Арахис', kk: 'Жержаңғақ', en: 'Peanuts' },
  soy: { ru: 'Соя', kk: 'Соя', en: 'Soy' },
  fish: { ru: 'Рыба', kk: 'Балық', en: 'Fish' },
  crustaceans: { ru: 'Ракообразные', kk: 'Шаян тәріздестер', en: 'Crustaceans' },
  molluscs: { ru: 'Моллюски', kk: 'Моллюскалар', en: 'Molluscs' },
  sesame: { ru: 'Кунжут', kk: 'Күнжіт', en: 'Sesame' },
  celery: { ru: 'Сельдерей', kk: 'Балдыркөк', en: 'Celery' },
  mustard: { ru: 'Горчица', kk: 'Қыша', en: 'Mustard' },
  sulphites: { ru: 'Сульфиты', kk: 'Сульфиттер', en: 'Sulphites' },
  lupin: { ru: 'Люпин', kk: 'Люпин', en: 'Lupin' },
} as const satisfies Record<string, Translatable>;

export type AllergenCode = keyof typeof ALLERGENS;
export const ALLERGEN_CODES = Object.keys(ALLERGENS) as AllergenCode[];

export function isAllergenCode(value: unknown): value is AllergenCode {
  return typeof value === 'string' && (ALLERGEN_CODES as string[]).includes(value);
}

/** Проверка и нормализация списка аллергенов: известные коды, без повторов, в порядке справочника. */
export function normalizeAllergens(codes: readonly string[] | null | undefined): AllergenCode[] {
  const set = new Set<string>();
  for (const raw of codes ?? []) {
    const code = raw.trim().toLowerCase();
    if (!isAllergenCode(code)) {
      throw new ValidationError('catalog.unknown_allergen', `Unknown allergen ${raw}`, { allergen: raw, allowed: ALLERGEN_CODES });
    }
    set.add(code);
  }
  return ALLERGEN_CODES.filter((c) => set.has(c));
}

export function allergenLabel(code: AllergenCode): Translatable {
  return ALLERGENS[code];
}
