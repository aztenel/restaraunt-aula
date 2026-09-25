import clsx from 'clsx';
import { stripUnsafeHtml } from '@/lib/html';

/**
 * HTML текстовой страницы от API. Бэкенд уже санитизирует разметку (белый список тегов),
 * витрина дополнительно вырезает исполняемое (stripUnsafeHtml) — защита в глубину.
 */
export function RichText({ html, className }: { html: string; className?: string }) {
  return <div className={clsx('prose-aula', className)} dangerouslySetInnerHTML={{ __html: stripUnsafeHtml(html) }} />;
}
