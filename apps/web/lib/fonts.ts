import { Lora, Manrope } from 'next/font/google';

/**
 * Шрифты скачиваются при сборке и раздаются с нашего домена (next/font), без запросов к Google
 * из браузера. Подмножества: латиница + кириллица + расширенная кириллица (казахский алфавит).
 * Если при сборке нет доступа к fonts.googleapis.com — заменить на next/font/local с файлами в репозитории;
 * в CSS уже задан системный запасной стек (--font-sans / --font-display).
 */
export const fontSans = Manrope({
  subsets: ['latin', 'cyrillic', 'cyrillic-ext'],
  display: 'swap',
  variable: '--font-manrope',
});

export const fontDisplay = Lora({
  subsets: ['latin', 'cyrillic', 'cyrillic-ext'],
  display: 'swap',
  variable: '--font-lora',
});

export const fontVariables = `${fontSans.variable} ${fontDisplay.variable}`;
