/**
 * Минимальный шаблонизатор {{ path.to.value }} для текстов уведомлений и документов.
 * Без логики в шаблонах — только подстановка. Отсутствующее значение -> пустая строка.
 */
export function renderTemplate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, params);
    return value === undefined || value === null ? '' : String(value);
  });
}

export function templateVariables(template: string): string[] {
  return [...template.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!);
}
