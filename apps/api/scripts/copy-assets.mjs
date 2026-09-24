// Копирует не-TS ассеты (SQL-миграции, шрифты, шаблоны) из src в dist после tsc.
import { cpSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const SRC = new URL('../src', import.meta.url).pathname;
const DIST = new URL('../dist', import.meta.url).pathname;
const EXT = ['.sql', '.ttf', '.json', '.hbs', '.txt', '.md'];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (EXT.some((ext) => full.endsWith(ext))) {
      const target = join(DIST, relative(SRC, full));
      mkdirSync(dirname(target), { recursive: true });
      cpSync(full, target);
    }
  }
}
walk(SRC);
