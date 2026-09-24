/**
 * Сравнение «было/стало» для журнала действий: плоский список путей с изменениями.
 * Объекты сравниваются рекурсивно, массивы и примитивы — как значения целиком.
 */
export type DiffKind = 'added' | 'removed' | 'changed' | 'unchanged';

export interface DiffEntry {
  path: string;
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function diffJson(before: unknown, after: unknown, path = ''): DiffEntry[] {
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((key) => {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in before)) return [{ path: childPath, kind: 'added' as const, after: after[key] }];
      if (!(key in after)) return [{ path: childPath, kind: 'removed' as const, before: before[key] }];
      return diffJson(before[key], after[key], childPath);
    });
  }
  const label = path || '(value)';
  if (before === undefined || before === null) {
    if (after === undefined || after === null) return [{ path: label, kind: 'unchanged', before, after }];
    return isPlainObject(after)
      ? Object.keys(after).sort().map((key) => ({ path: path ? `${path}.${key}` : key, kind: 'added' as const, after: after[key] }))
      : [{ path: label, kind: 'added', after }];
  }
  if (after === undefined || after === null) {
    return isPlainObject(before)
      ? Object.keys(before).sort().map((key) => ({ path: path ? `${path}.${key}` : key, kind: 'removed' as const, before: before[key] }))
      : [{ path: label, kind: 'removed', before }];
  }
  return [{ path: label, kind: sameValue(before, after) ? 'unchanged' : 'changed', before, after }];
}

export function formatJsonValue(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
