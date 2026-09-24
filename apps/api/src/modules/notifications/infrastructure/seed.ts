import { ModuleSeeder } from '../../../shared/infrastructure/seed/seed.types';
import { allDefaultTemplateTexts } from '../domain/default-templates';
import { TemplateRepository } from './template.repository';

/**
 * Стартовые данные Notifications: тексты шаблонов (ru, kk) для всех ключей и каналов.
 * Идемпотентно: вставляются только отсутствующие тексты, отредактированные в админке не меняются.
 * Демо-данных у модуля нет (настройки каналов — в админке: Интеграции -> Уведомления).
 */
export const seedNotifications: ModuleSeeder = async (ctx) => {
  const templates = ctx.app.get(TemplateRepository);
  const inserted = await templates.insertMissing(
    allDefaultTemplateTexts().map((t) => ({
      key: t.key,
      channel: t.channel,
      locale: t.locale,
      subject: t.text.subject ?? null,
      body: t.text.body,
    })),
  );
  ctx.log(inserted > 0 ? `Шаблоны уведомлений: добавлено ${inserted}` : 'Шаблоны уведомлений: без изменений');
};
