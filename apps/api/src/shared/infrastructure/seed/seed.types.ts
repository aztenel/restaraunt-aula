import { INestApplicationContext } from '@nestjs/common';

/**
 * Контекст стартовых данных. Сиды идемпотентны: повторный запуск не создаёт дубликатов
 * (поиск по естественным ключам: slug, code, bin, email).
 */
export interface SeedContext {
  app: INestApplicationContext;
  /** Филиалы по slug: { greenline: '<uuid>', 'garden-view': '<uuid>' }. */
  branches: Record<string, string>;
  legalEntityId: string;
  ownerUserId: string;
  /** Демо-данные (меню, залы, промокоды) — для dev и staging. */
  demo: boolean;
  log: (message: string) => void;
}

export type ModuleSeeder = (ctx: SeedContext) => Promise<void>;
