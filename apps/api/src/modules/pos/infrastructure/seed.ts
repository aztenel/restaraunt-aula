import { IntegrationSettings } from '../../../shared/infrastructure/settings/integration-settings';
import { ModuleSeeder } from '../../../shared/infrastructure/seed/seed.types';
import { POS_ROUTING_SETTINGS_KEY } from '../application/pos-client.registry';
import { DEFAULT_POS_ROUTING } from '../domain/routing';

/**
 * Стартовые данные POS. Какая POS стоит на точках — неизвестно (открытый вопрос ТЗ), поэтому все филиалы
 * работают в режиме manual (кухня по экрану админки). Создаётся запись маршрутизации, чтобы администратор
 * видел её в разделе «Интеграции» и мог направить филиал во внешнюю POS после discovery.
 * Идемпотентно: существующая настройка (в БД или из переменной окружения) не меняется.
 * Демо-данных нет: без реальной POS сопоставлять не с чем.
 */
export const seedPos: ModuleSeeder = async (ctx) => {
  const settings = ctx.app.get(IntegrationSettings);
  if (await settings.getRaw(POS_ROUTING_SETTINGS_KEY)) return;
  await settings.set(
    POS_ROUTING_SETTINGS_KEY,
    { enabled: true, config: { default: DEFAULT_POS_ROUTING.default, branches: {} } },
    null,
  );
  ctx.log(`POS: все филиалы в режиме ${DEFAULT_POS_ROUTING.default} (настройка ${POS_ROUTING_SETTINGS_KEY})`);
};
