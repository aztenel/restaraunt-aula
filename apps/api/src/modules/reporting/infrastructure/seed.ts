import { ModuleSeeder } from '../../../shared/infrastructure/seed/seed.types';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { Money } from '../../../shared/kernel/money';
import { addDays } from '../../../shared/kernel/time';
import { SaveAggregatorVolume } from '../application/aggregator-volume.actions';
import { localDateOf, monthOf, monthPeriod } from '../domain/period';
import { AggregatorVolumeRepository } from './aggregator-volume.repository';

/**
 * Стартовые данные Reporting. Справочников у модуля нет: проекции строятся из событий
 * других модулей (демо-заказы, брони и банкеты попадают в отчёты через их события).
 * Демо: помесячные итоги агрегаторов за 3 последних месяца (ручной ввод управляющего) —
 * для отчёта «Доля своего канала». Идемпотентно: существующие записи не перезаписываются.
 */
const DEMO_AGGREGATORS = [
  { source: 'aggregator_a', sourceName: 'Агрегатор A (демо)', orders: 420, revenueTenge: 3_150_000 },
  { source: 'aggregator_b', sourceName: 'Агрегатор B (демо)', orders: 260, revenueTenge: 1_980_000 },
];

export const seedReporting: ModuleSeeder = async (ctx) => {
  if (!ctx.demo) {
    ctx.log('Reporting: справочников нет, проекции строятся из событий модулей');
    return;
  }
  const save = ctx.app.get(SaveAggregatorVolume);
  const volumes = ctx.app.get(AggregatorVolumeRepository);
  const today = localDateOf(ctx.app.get(Clock).now());
  const months: string[] = [];
  let cursor = monthOf(today);
  for (let i = 0; i < 3; i++) {
    cursor = monthOf(addDays(monthPeriod(cursor).from, -1));
    months.unshift(cursor);
  }
  const system = Actor.system('seed');
  let created = 0;
  for (const branchId of Object.values(ctx.branches)) {
    for (const [idx, month] of months.entries()) {
      for (const agg of DEMO_AGGREGATORS) {
        if (await volumes.find(branchId, month, agg.source)) continue;
        // Небольшой рост своего канала от месяца к месяцу — доля агрегаторов снижается.
        const factor = 100 - idx * 8;
        await save.execute(system, {
          branchId,
          month,
          source: agg.source,
          sourceName: agg.sourceName,
          orders: Math.round((agg.orders * factor) / 100),
          revenue: Money.tenge(Math.round((agg.revenueTenge * factor) / 100)),
        });
        created++;
      }
    }
  }
  ctx.log(`Reporting: демо-итоги агрегаторов (${months.join(', ')}): добавлено ${created}`);
};
