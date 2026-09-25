import { ModuleSeeder } from '../shared/infrastructure/seed/seed.types';
import { seedCatalog } from './catalog/infrastructure/seed';
import { seedCustomers } from './customers/infrastructure/seed';
import { seedPayments } from './payments/infrastructure/seed';
import { seedPos } from './pos/infrastructure/seed';
import { seedReporting } from './reporting/infrastructure/seed';

/**
 * Сиды доменных модулей (после Identity). Каждый модуль экспортирует свой ModuleSeeder
 * из infrastructure/seed.ts; порядок важен только для демо-данных.
 */
export const MODULE_SEEDERS: Array<{ module: string; seed: ModuleSeeder }> = [
  { module: 'customers', seed: seedCustomers },
  { module: 'catalog', seed: seedCatalog },
  { module: 'payments', seed: seedPayments },
  { module: 'reporting', seed: seedReporting },
  { module: 'pos', seed: seedPos },
];
