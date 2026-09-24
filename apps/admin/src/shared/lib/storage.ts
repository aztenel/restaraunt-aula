import { useCallback, useState } from 'react';

/** Безопасный доступ к localStorage (приватный режим, запрет хранилища). */
export function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeStorage(key: string, value: unknown): void {
  try {
    if (value === undefined) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // no-op
  }
}

/** Состояние, сохраняемое в localStorage. */
export function useStoredState<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readStorage(key, fallback));
  const update = useCallback(
    (next: T) => {
      setValue(next);
      writeStorage(key, next);
    },
    [key],
  );
  return [value, update];
}
