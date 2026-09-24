'use client';

/**
 * Корзина гостя. Хранит ТОЛЬКО идентификаторы блюд, выбранные опции модификаторов, количества
 * и филиал — в localStorage. Цены, суммы, скидки, доставку и доступность клиент НЕ считает:
 * итог всегда приходит с сервера (POST /api/v1/public/orders/quote → toQuoteLines(state)).
 */
import { createContext, createElement, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';

export const CART_STORAGE_KEY = 'aula_cart_v1';
/** Ограничение ввода; то же ограничение проверяет сервер (catalog.quantity_invalid: 1..99). */
export const MAX_LINE_QUANTITY = 99;

export interface CartLine {
  /** Ключ строки: блюдо + набор опций (порядок опций не важен). */
  key: string;
  dishId: string;
  modifierOptionIds: string[];
  quantity: number;
}

export interface CartState {
  version: 1;
  /** Филиал, по меню которого собрана корзина (цены задаются по филиалу). */
  branchId: string | null;
  lines: CartLine[];
  updatedAt: string | null;
}

export const EMPTY_CART: CartState = Object.freeze({
  version: 1,
  branchId: null,
  lines: [],
  updatedAt: null,
}) as CartState;

export type CartAction =
  | { type: 'add'; dishId: string; modifierOptionIds?: string[]; quantity?: number; branchId?: string | null }
  | { type: 'setQuantity'; key: string; quantity: number }
  | { type: 'remove'; key: string }
  | { type: 'setBranch'; branchId: string | null }
  | { type: 'clear' }
  | { type: 'replace'; state: CartState };

export function normalizeModifierIds(ids: readonly string[] | undefined): string[] {
  return [...new Set((ids ?? []).filter((id) => typeof id === 'string' && id.length > 0))].sort();
}

export function lineKey(dishId: string, modifierOptionIds: readonly string[] | undefined): string {
  return `${dishId}|${normalizeModifierIds(modifierOptionIds).join(',')}`;
}

/** Целое 0..MAX_LINE_QUANTITY (0 — удалить строку). */
export function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 0;
  return Math.min(MAX_LINE_QUANTITY, Math.max(0, Math.trunc(quantity)));
}

export function cartReducer(state: CartState, action: CartAction, now: () => string = () => new Date().toISOString()): CartState {
  switch (action.type) {
    case 'add': {
      const quantity = clampQuantity(action.quantity ?? 1);
      if (!action.dishId || quantity === 0) return state;
      const modifierOptionIds = normalizeModifierIds(action.modifierOptionIds);
      const key = lineKey(action.dishId, modifierOptionIds);
      const existing = state.lines.find((line) => line.key === key);
      const lines = existing
        ? state.lines.map((line) =>
            line.key === key ? { ...line, quantity: clampQuantity(line.quantity + quantity) } : line,
          )
        : [...state.lines, { key, dishId: action.dishId, modifierOptionIds, quantity }];
      return { ...state, branchId: action.branchId ?? state.branchId, lines, updatedAt: now() };
    }
    case 'setQuantity': {
      const quantity = clampQuantity(action.quantity);
      if (!state.lines.some((line) => line.key === action.key)) return state;
      const lines =
        quantity === 0
          ? state.lines.filter((line) => line.key !== action.key)
          : state.lines.map((line) => (line.key === action.key ? { ...line, quantity } : line));
      return { ...state, lines, updatedAt: now() };
    }
    case 'remove': {
      if (!state.lines.some((line) => line.key === action.key)) return state;
      return { ...state, lines: state.lines.filter((line) => line.key !== action.key), updatedAt: now() };
    }
    case 'setBranch':
      // Позиции сохраняются: доступность и цены в новом филиале проверит сервер при расчёте.
      return state.branchId === action.branchId ? state : { ...state, branchId: action.branchId, updatedAt: now() };
    case 'clear':
      return { ...EMPTY_CART, branchId: state.branchId, updatedAt: now() };
    case 'replace':
      return action.state;
    default:
      return state;
  }
}

/** Разбор сохранённой корзины с проверкой формы; повреждённые данные → пустая корзина. */
export function parseCart(raw: string | null | undefined): CartState {
  if (!raw) return EMPTY_CART;
  try {
    const data = JSON.parse(raw) as Partial<CartState> | null;
    if (!data || data.version !== 1 || !Array.isArray(data.lines)) return EMPTY_CART;
    const lines: CartLine[] = [];
    for (const item of data.lines as unknown[]) {
      if (!item || typeof item !== 'object') continue;
      const { dishId, modifierOptionIds, quantity } = item as Partial<CartLine>;
      if (typeof dishId !== 'string' || !dishId) continue;
      const q = clampQuantity(typeof quantity === 'number' ? quantity : 0);
      if (q === 0) continue;
      const ids = normalizeModifierIds(Array.isArray(modifierOptionIds) ? modifierOptionIds : []);
      const key = lineKey(dishId, ids);
      const existing = lines.find((line) => line.key === key);
      if (existing) existing.quantity = clampQuantity(existing.quantity + q);
      else lines.push({ key, dishId, modifierOptionIds: ids, quantity: q });
    }
    return {
      version: 1,
      branchId: typeof data.branchId === 'string' ? data.branchId : null,
      lines,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
    };
  } catch {
    return EMPTY_CART;
  }
}

/** Количество порций (для значка корзины) — счётчик, не деньги. */
export function cartItemCount(state: CartState): number {
  return state.lines.reduce((sum, line) => sum + line.quantity, 0);
}

/** Позиции для расчёта на сервере: POST /api/v1/public/orders/quote. */
export function toQuoteLines(state: CartState): Array<{ dishId: string; quantity: number; modifierOptionIds: string[] }> {
  return state.lines.map(({ dishId, quantity, modifierOptionIds }) => ({ dishId, quantity, modifierOptionIds }));
}

type CartStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface CartStore {
  getSnapshot(): CartState;
  getServerSnapshot(): CartState;
  subscribe(listener: () => void): () => void;
  dispatch(action: CartAction): void;
}

/** localStorage может быть недоступен (приватный режим, запрет cookies) — корзина работает в памяти. */
export function safeLocalStorage(): CartStorage | null {
  try {
    if (typeof window === 'undefined') return null;
    const storage = window.localStorage;
    const probe = '__aula_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export function createCartStore(storage: CartStorage | null, key: string = CART_STORAGE_KEY): CartStore {
  let state: CartState | null = null;
  const listeners = new Set<() => void>();

  const load = (): CartState => {
    try {
      return parseCart(storage?.getItem(key));
    } catch {
      return EMPTY_CART;
    }
  };

  const emit = () => listeners.forEach((listener) => listener());

  // Синхронизация между вкладками.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== key) return;
    state = parseCart(event.newValue);
    emit();
  };

  return {
    getSnapshot() {
      if (state === null) state = load();
      return state;
    },
    getServerSnapshot() {
      return EMPTY_CART;
    },
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
      };
    },
    dispatch(action) {
      const current = state ?? load();
      const next = cartReducer(current, action);
      if (next === current) return;
      state = next;
      try {
        if (next.lines.length === 0 && next.branchId === null) storage?.removeItem(key);
        else storage?.setItem(key, JSON.stringify(next));
      } catch {
        // Переполнение/запрет хранилища: корзина продолжит работать в памяти.
      }
      emit();
    },
  };
}

const CartContext = createContext<CartStore | null>(null);

export function CartProvider({ children, store }: { children: ReactNode; store?: CartStore }) {
  const [value] = useState(() => store ?? createCartStore(safeLocalStorage()));
  return createElement(CartContext.Provider, { value }, children);
}

export interface UseCartResult {
  state: CartState;
  lines: CartLine[];
  branchId: string | null;
  /** Количество порций в корзине. */
  count: number;
  add(input: { dishId: string; modifierOptionIds?: string[]; quantity?: number; branchId?: string | null }): void;
  setQuantity(key: string, quantity: number): void;
  remove(key: string): void;
  setBranch(branchId: string | null): void;
  clear(): void;
}

export function useCart(): UseCartResult {
  const store = useContext(CartContext);
  if (!store) throw new Error('useCart must be used inside <CartProvider>');
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return useMemo(
    () => ({
      state,
      lines: state.lines,
      branchId: state.branchId,
      count: cartItemCount(state),
      add: (input) => store.dispatch({ type: 'add', ...input }),
      setQuantity: (key, quantity) => store.dispatch({ type: 'setQuantity', key, quantity }),
      remove: (key) => store.dispatch({ type: 'remove', key }),
      setBranch: (branchId) => store.dispatch({ type: 'setBranch', branchId }),
      clear: () => store.dispatch({ type: 'clear' }),
    }),
    [state, store],
  );
}
