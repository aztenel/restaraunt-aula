import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  CART_STORAGE_KEY,
  CartProvider,
  EMPTY_CART,
  MAX_LINE_QUANTITY,
  cartItemCount,
  cartReducer,
  createCartStore,
  lineKey,
  parseCart,
  toQuoteLines,
  useCart,
  type CartState,
} from '@/lib/cart';

const now = () => '2026-09-25T10:00:00.000Z';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe('cartReducer', () => {
  it('добавляет позицию и объединяет одинаковые блюдо+опции независимо от порядка опций', () => {
    let state = cartReducer(EMPTY_CART, { type: 'add', dishId: 'd1', modifierOptionIds: ['b', 'a'] }, now);
    state = cartReducer(state, { type: 'add', dishId: 'd1', modifierOptionIds: ['a', 'b'], quantity: 2 }, now);
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0]).toMatchObject({ dishId: 'd1', modifierOptionIds: ['a', 'b'], quantity: 3 });
    expect(state.updatedAt).toBe(now());
  });

  it('разные наборы опций — разные строки', () => {
    let state = cartReducer(EMPTY_CART, { type: 'add', dishId: 'd1', modifierOptionIds: ['a'] }, now);
    state = cartReducer(state, { type: 'add', dishId: 'd1', modifierOptionIds: ['b'] }, now);
    state = cartReducer(state, { type: 'add', dishId: 'd1' }, now);
    expect(state.lines.map((l) => l.key)).toEqual([lineKey('d1', ['a']), lineKey('d1', ['b']), lineKey('d1', [])]);
    expect(cartItemCount(state)).toBe(3);
  });

  it('ограничивает количество 1..99 и удаляет строку при 0', () => {
    let state = cartReducer(EMPTY_CART, { type: 'add', dishId: 'd1', quantity: 500 }, now);
    expect(state.lines[0]?.quantity).toBe(MAX_LINE_QUANTITY);
    const key = state.lines[0]!.key;
    state = cartReducer(state, { type: 'setQuantity', key, quantity: 2.7 }, now);
    expect(state.lines[0]?.quantity).toBe(2);
    state = cartReducer(state, { type: 'setQuantity', key, quantity: 0 }, now);
    expect(state.lines).toHaveLength(0);
  });

  it('игнорирует добавление с нулевым количеством и неизвестные ключи', () => {
    const state = cartReducer(EMPTY_CART, { type: 'add', dishId: 'd1', quantity: 0 }, now);
    expect(state).toBe(EMPTY_CART);
    expect(cartReducer(EMPTY_CART, { type: 'remove', key: 'nope' }, now)).toBe(EMPTY_CART);
  });

  it('смена филиала сохраняет позиции; очистка сохраняет филиал', () => {
    let state = cartReducer(EMPTY_CART, { type: 'add', dishId: 'd1', branchId: 'b1' }, now);
    state = cartReducer(state, { type: 'setBranch', branchId: 'b2' }, now);
    expect(state.branchId).toBe('b2');
    expect(state.lines).toHaveLength(1);
    state = cartReducer(state, { type: 'clear' }, now);
    expect(state.lines).toHaveLength(0);
    expect(state.branchId).toBe('b2');
  });

  it('в корзине нет цен и сумм: toQuoteLines отдаёт только идентификаторы и количества', () => {
    const state = cartReducer(EMPTY_CART, { type: 'add', dishId: 'd1', modifierOptionIds: ['m1'], quantity: 2 }, now);
    expect(toQuoteLines(state)).toEqual([{ dishId: 'd1', quantity: 2, modifierOptionIds: ['m1'] }]);
    expect(JSON.stringify(state)).not.toMatch(/price|amount|total/i);
  });
});

describe('parseCart', () => {
  it('возвращает пустую корзину для повреждённых данных', () => {
    expect(parseCart('{oops')).toBe(EMPTY_CART);
    expect(parseCart(JSON.stringify({ version: 2, lines: [] }))).toBe(EMPTY_CART);
    expect(parseCart(null)).toBe(EMPTY_CART);
  });

  it('отбрасывает некорректные строки и объединяет дубли', () => {
    const raw = JSON.stringify({
      version: 1,
      branchId: 'b1',
      lines: [
        { dishId: 'd1', modifierOptionIds: ['x'], quantity: 1 },
        { dishId: 'd1', modifierOptionIds: ['x'], quantity: 2 },
        { dishId: '', quantity: 1 },
        { dishId: 'd2', quantity: -3 },
        null,
      ],
      updatedAt: null,
    });
    const state = parseCart(raw);
    expect(state.branchId).toBe('b1');
    expect(state.lines).toEqual([{ key: lineKey('d1', ['x']), dishId: 'd1', modifierOptionIds: ['x'], quantity: 3 }]);
  });
});

describe('createCartStore', () => {
  it('сохраняет корзину в хранилище и читает её обратно', () => {
    const storage = memoryStorage();
    const store = createCartStore(storage);
    store.dispatch({ type: 'add', dishId: 'd1', branchId: 'b1' });
    const saved = storage.data.get(CART_STORAGE_KEY);
    expect(saved).toBeDefined();
    const restored = createCartStore(storage).getSnapshot();
    expect(restored.lines).toHaveLength(1);
    expect(restored.branchId).toBe('b1');
  });

  it('работает без хранилища (приватный режим)', () => {
    const store = createCartStore(null);
    store.dispatch({ type: 'add', dishId: 'd1' });
    expect(store.getSnapshot().lines).toHaveLength(1);
  });

  it('серверный снимок всегда пустой (без рассинхронизации гидратации)', () => {
    const storage = memoryStorage({
      [CART_STORAGE_KEY]: JSON.stringify({ version: 1, branchId: null, lines: [{ dishId: 'd1', modifierOptionIds: [], quantity: 1 }] }),
    });
    const store = createCartStore(storage);
    expect(store.getServerSnapshot()).toBe(EMPTY_CART);
    expect(store.getSnapshot().lines).toHaveLength(1);
  });

  it('оповещает подписчиков', () => {
    const store = createCartStore(null);
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    store.dispatch({ type: 'add', dishId: 'd1' });
    unsubscribe();
    store.dispatch({ type: 'add', dishId: 'd2' });
    expect(calls).toBe(1);
  });
});

describe('useCart', () => {
  function Probe() {
    const cart = useCart();
    return (
      <div>
        <span data-testid="count">{cart.count}</span>
        <button type="button" onClick={() => cart.add({ dishId: 'd1', quantity: 2 })}>
          add
        </button>
      </div>
    );
  }

  it('отдаёт количество и действия через контекст', () => {
    const store = createCartStore(memoryStorage());
    render(
      <CartProvider store={store}>
        <Probe />
      </CartProvider>,
    );
    expect(screen.getByTestId('count').textContent).toBe('0');
    act(() => screen.getByText('add').click());
    expect(screen.getByTestId('count').textContent).toBe('2');
    const snapshot: CartState = store.getSnapshot();
    expect(snapshot.lines[0]?.quantity).toBe(2);
  });
});
