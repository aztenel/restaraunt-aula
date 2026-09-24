import { describe, expect, it } from 'vitest';
import { diffJson } from './json-diff';

describe('diffJson: «было → стало» журнала действий', () => {
  it('изменённые, добавленные и удалённые поля, вложенные объекты', () => {
    const entries = diffJson(
      { name: 'A', phone: null, settings: { acceptsDelivery: true, lead: 30 }, roles: ['a'] },
      { name: 'B', email: 'x@y.kz', settings: { acceptsDelivery: true, lead: 45 }, roles: ['a', 'b'] },
    );
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));
    expect(byPath.name).toMatchObject({ kind: 'changed', before: 'A', after: 'B' });
    expect(byPath.email).toMatchObject({ kind: 'added', after: 'x@y.kz' });
    expect(byPath.phone).toMatchObject({ kind: 'removed' });
    expect(byPath['settings.lead']).toMatchObject({ kind: 'changed', before: 30, after: 45 });
    expect(byPath['settings.acceptsDelivery']).toMatchObject({ kind: 'unchanged' });
    expect(byPath.roles).toMatchObject({ kind: 'changed' });
  });

  it('создание (before = null) и удаление (after = null)', () => {
    expect(diffJson(null, { a: 1, b: 2 }).map((e) => [e.path, e.kind])).toEqual([
      ['a', 'added'],
      ['b', 'added'],
    ]);
    expect(diffJson({ a: 1 }, null)).toEqual([{ path: 'a', kind: 'removed', before: 1 }]);
    expect(diffJson(null, null)).toEqual([{ path: '(value)', kind: 'unchanged', before: null, after: null }]);
    expect(diffJson('x', 'y')).toEqual([{ path: '(value)', kind: 'changed', before: 'x', after: 'y' }]);
  });
});
