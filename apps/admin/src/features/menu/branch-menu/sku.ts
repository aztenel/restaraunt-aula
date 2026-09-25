/** Код POS филиала из поля ввода: пробелы по краям убираются, пустое значение — сброс (null). */
export function skuToSave(input: string | null | undefined): string | null {
  const value = (input ?? '').trim();
  return value ? value : null;
}
