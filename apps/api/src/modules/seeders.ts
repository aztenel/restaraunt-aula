import { ModuleSeeder } from '../shared/infrastructure/seed/seed.types';

/**
 * Сиды доменных модулей (после Identity). Каждый модуль экспортирует свой ModuleSeeder
 * из infrastructure/seed.ts; порядок важен только для демо-данных.
 */
export const MODULE_SEEDERS: Array<{ module: string; seed: ModuleSeeder }> = [];
