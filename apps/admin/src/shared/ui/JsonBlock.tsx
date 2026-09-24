/** Отформатированный JSON (полезная нагрузка задач, запросы/ответы интеграций). */
export function JsonBlock({ value, maxHeight = 320 }: { value: unknown; maxHeight?: number }) {
  let text: string;
  try {
    text = value === undefined ? '' : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return (
    <pre style={{ margin: 0, padding: 12, background: '#faf7f2', borderRadius: 8, maxHeight, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {text || '—'}
    </pre>
  );
}
