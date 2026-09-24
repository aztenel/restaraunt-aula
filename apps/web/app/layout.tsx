import type { ReactNode } from 'react';
import './globals.css';

/**
 * Корневой layout. <html lang> задаётся в app/[locale]/layout.tsx — у каждой страницы свой язык.
 * Файл нужен для корневой страницы 404 (адреса вне языковых разделов).
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
