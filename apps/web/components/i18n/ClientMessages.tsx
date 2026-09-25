import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { CLIENT_NAMESPACES, pickMessages } from '@/lib/messages';

/**
 * Сообщения для клиентских компонентов конкретного раздела (меню, корзина, сертификаты).
 * Вложенный провайдер заменяет сообщения родителя, поэтому общие пространства имён добавляются всегда.
 */
export async function ClientMessages({ namespaces, children }: { namespaces: readonly string[]; children: ReactNode }) {
  const messages = await getMessages();
  return (
    <NextIntlClientProvider messages={pickMessages(messages, [...CLIENT_NAMESPACES, ...namespaces])}>{children}</NextIntlClientProvider>
  );
}
