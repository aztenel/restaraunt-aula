/**
 * Автоподбор сопоставления «товар POS -> блюдо витрины» по нормализованному названию.
 * Подсказка, а не решение: сопоставление подтверждает сотрудник.
 */

/** Единицы веса/объёма/штук после числа в названии («Плов 350 г», «Айран 0,5 л»). */
const MEASURE_RE = /\d+(?:[.,]\d+)?\s*(?:гр|г|кг|мл|л|шт|порц|g|gr|kg|ml|l|pcs)(?=$|[^\p{L}])/giu;

export function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(MEASURE_RE, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(normalized: string): string[] {
  return [...new Set(normalized.split(' ').filter((t) => t.length > 0))];
}

/** Слова совпадают, если равны или одно — начало другого не короче 4 букв (плов/плова, лагман/лагмана). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short);
}

/** Похожесть названий 0..1 (1 — совпадение после нормализации). */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeProductName(a);
  const nb = normalizeProductName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(na);
  const tb = tokens(nb);
  const matched = ta.filter((x) => tb.some((y) => sameWord(x, y))).length;
  if (matched === 0) return 0;
  const union = ta.length + tb.length - matched;
  const jaccard = matched / union;
  const containment = matched / Math.min(ta.length, tb.length);
  // Точное совпадение — только при равенстве строк; остальное не выше 0.95.
  return Math.min(0.95, Math.round((0.6 * jaccard + 0.4 * containment) * 100) / 100);
}

/**
 * Значимые слова названия для поиска кандидатов в меню (по порядку: в названиях блюд главное слово
 * обычно первое — «Плов узбекский», «Лагман гуйру»). Числа и короткие слова пропускаются.
 */
export function searchKeywords(name: string, max = 3): string[] {
  return tokens(normalizeProductName(name))
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t))
    .slice(0, max);
}

export interface MatchCandidate {
  dishId: string;
  /** Названия блюда на всех языках. */
  names: string[];
}

export interface MatchSuggestion {
  dishId: string;
  score: number;
}

export const SUGGESTION_MIN_SCORE = 0.5;

/** Кандидаты по убыванию похожести (не ниже minScore). */
export function rankCandidates(
  productName: string,
  candidates: readonly MatchCandidate[],
  options: { minScore?: number; limit?: number } = {},
): MatchSuggestion[] {
  const minScore = options.minScore ?? SUGGESTION_MIN_SCORE;
  const best = new Map<string, number>();
  for (const candidate of candidates) {
    const score = Math.max(0, ...candidate.names.map((n) => nameSimilarity(productName, n)));
    if (score >= minScore && score > (best.get(candidate.dishId) ?? -1)) best.set(candidate.dishId, score);
  }
  return [...best.entries()]
    .map(([dishId, score]) => ({ dishId, score }))
    .sort((a, b) => b.score - a.score || a.dishId.localeCompare(b.dishId))
    .slice(0, options.limit ?? 5);
}
