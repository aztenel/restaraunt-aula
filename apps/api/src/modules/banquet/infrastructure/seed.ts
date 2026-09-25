import { ModuleSeeder } from '../../../shared/infrastructure/seed/seed.types';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { Money } from '../../../shared/kernel/money';
import { pageRequest } from '../../../shared/kernel/pagination';
import { addDays, toLocalDate } from '../../../shared/kernel/time';
import { CreateBanquetRequest } from '../application/create-request.action';
import { SaveQuoteVersion } from '../application/quote.actions';
import { SaveContractTemplate } from '../application/template.actions';
import { RequestRepository } from './request.repository';
import { TemplateRepository } from './template.repository';

export const DEFAULT_CONTRACT_TEMPLATE_CODE = 'banquet-standard';
const DEMO_CONTACT_NAME = 'Айгерим Сапарова (демо)';

/** Типовой договор на банкетное обслуживание (редактируется в админке: Банкеты → Шаблоны договоров). */
export const DEFAULT_CONTRACT_TEMPLATE = `ДОГОВОР № {{contract.number}}
на оказание услуг по организации банкета

г. Астана, {{contract.date}}

{{seller.name}}, БИН {{seller.bin}}, именуемое в дальнейшем «Исполнитель», в лице {{seller.directorPosition}} {{seller.directorName}}, действующего на основании {{seller.actingBasis}}, с одной стороны, и {{client.name}}, БИН/ИИН {{client.bin}}, именуемое в дальнейшем «Заказчик», в лице {{client.directorPosition}} {{client.directorName}}, действующего на основании {{client.actingBasis}}, с другой стороны, совместно именуемые «Стороны», заключили настоящий договор о нижеследующем.

1. ПРЕДМЕТ ДОГОВОРА
1.1. Исполнитель обязуется оказать услуги по организации и проведению мероприятия «{{event.type}}» (далее — Мероприятие), а Заказчик обязуется принять и оплатить оказанные услуги.
1.2. Дата проведения Мероприятия: {{event.date}}, начало в {{event.time}}. Место проведения: {{event.place}}. Зал: {{event.venue}}. Количество гостей: {{event.guests}}.
1.3. Состав меню, напитков и дополнительных услуг определяется сметой по заявке № {{request.number}} (версия {{quote.version}}), согласованной Заказчиком. Смета является неотъемлемой частью настоящего договора.

2. СТОИМОСТЬ УСЛУГ И ПОРЯДОК РАСЧЁТОВ
2.1. Стоимость услуг по настоящему договору составляет {{quote.total}} ({{quote.totalWords}}), {{seller.vat}}. Стоимость в расчёте на одного гостя — {{quote.perGuest}}.
2.2. Заказчик вносит предоплату в размере {{prepayment.amount}} ({{prepayment.amountWords}}) в срок, указанный в счёте на оплату. Внесение предоплаты подтверждает бронирование даты и зала.
2.3. Окончательный расчёт производится не позднее дня проведения Мероприятия. Изменение количества гостей более чем на 10% согласовывается Сторонами не позднее чем за 3 (три) дня до Мероприятия и оформляется новой версией сметы.
2.4. Оплата производится безналичным перечислением на банковский счёт Исполнителя: ИИК {{seller.iban}} в {{seller.bankName}}, БИК {{seller.bik}}, КБе {{seller.kbe}}, либо иным способом, не противоречащим законодательству Республики Казахстан.

3. ПРАВА И ОБЯЗАННОСТИ СТОРОН
3.1. Исполнитель обязуется: подготовить зал, сервировку и обслуживание в соответствии со сметой; обеспечить качество и безопасность блюд и напитков в соответствии с санитарными требованиями; назначить ответственного менеджера — {{manager.name}}, тел. {{manager.phone}}.
3.2. Заказчик обязуется: своевременно оплатить услуги; не позднее чем за 3 (три) дня сообщить Исполнителю об изменениях в количестве гостей и программе Мероприятия; обеспечить соблюдение гостями правил заведения; возместить ущерб, причинённый имуществу Исполнителя гостями Заказчика.
3.3. Заказчик вправе приносить собственную продукцию только по согласованию с Исполнителем.

4. ОТМЕНА И ПЕРЕНОС МЕРОПРИЯТИЯ
4.1. Заказчик вправе отказаться от Мероприятия, уведомив Исполнителя в письменной форме. При отмене позднее чем за 7 (семь) дней до даты Мероприятия Исполнитель вправе удержать из предоплаты фактически понесённые расходы.
4.2. Перенос даты Мероприятия возможен по соглашению Сторон при наличии свободного зала на новую дату.

5. ОТВЕТСТВЕННОСТЬ СТОРОН
5.1. За неисполнение или ненадлежащее исполнение обязательств Стороны несут ответственность в соответствии с законодательством Республики Казахстан.
5.2. Стороны освобождаются от ответственности за неисполнение обязательств, вызванное обстоятельствами непреодолимой силы, при условии уведомления другой Стороны в течение 3 (трёх) дней с момента их наступления.

6. ЗАКЛЮЧИТЕЛЬНЫЕ ПОЛОЖЕНИЯ
6.1. Договор вступает в силу с момента подписания и действует до полного исполнения Сторонами своих обязательств.
6.2. По завершении Мероприятия Стороны подписывают акт выполненных работ (оказанных услуг).
6.3. Споры разрешаются путём переговоров, а при недостижении согласия — в суде по месту нахождения Исполнителя.
6.4. Договор составлен в двух экземплярах на русском языке, имеющих одинаковую юридическую силу, по одному для каждой из Сторон.

Контактное лицо Заказчика: {{client.contactName}}, тел. {{client.phone}}, email {{client.email}}.`;

/**
 * Стартовые данные Banquet (идемпотентно):
 * - всегда: типовой шаблон договора на банкетное обслуживание (по коду banquet-standard);
 * - демо: одна банкетная заявка в GreenLine со сметой (поиск по имени контакта).
 */
export const seedBanquet: ModuleSeeder = async (ctx) => {
  const actor = Actor.system('seed');
  const templates = ctx.app.get(TemplateRepository);
  if (!(await templates.findByCode(DEFAULT_CONTRACT_TEMPLATE_CODE))) {
    await ctx.app.get(SaveContractTemplate).execute(actor, null, {
      code: DEFAULT_CONTRACT_TEMPLATE_CODE,
      name: 'Договор на банкетное обслуживание',
      body: DEFAULT_CONTRACT_TEMPLATE,
      isDefault: true,
    });
    ctx.log('Шаблон договора на банкетное обслуживание создан');
  }
  if (!ctx.demo) return;
  const branchId = ctx.branches.greenline;
  if (!branchId) return;
  const requests = ctx.app.get(RequestRepository);
  const existing = await requests.list({ branches: 'all', q: '(демо)' }, pageRequest(1, 1));
  if (existing.total > 0) return;
  const today = toLocalDate(ctx.app.get(Clock).now());
  const request = await ctx.app.get(CreateBanquetRequest).execute(
    actor,
    {
      eventDate: addDays(today, 30),
      eventTime: '18:00',
      eventType: 'wedding',
      guests: 120,
      branchId,
      budget: Money.tenge(4_000_000),
      contact: { name: DEMO_CONTACT_NAME, phone: '+77010000123', email: 'demo.banquet@aula.kz' },
      wishes: 'Той на 120 гостей: национальная кухня, живая музыка, оформление в белых тонах.',
      locale: 'ru',
      consent: { personalData: true },
    },
    { source: 'admin', ip: null },
  );
  await ctx.app.get(SaveQuoteVersion).execute(actor, request.id, {
    lines: [
      { kind: 'other', title: { ru: 'Банкетное меню «Той» (на гостя)', kk: '«Той» банкет мәзірі (бір қонаққа)' }, unit: 'чел.', unitPrice: Money.tenge(25_000), quantity: 120 },
      { kind: 'hall_rent', title: { ru: 'Аренда зала', kk: 'Зал жалға алу' }, unit: 'усл.', unitPrice: Money.tenge(300_000), quantity: 1 },
      { kind: 'musicians', title: { ru: 'Живая музыка (домбра, вокал)', kk: 'Тірі музыка (домбыра, вокал)' }, unit: 'час', unitPrice: Money.tenge(50_000), quantity: 4 },
      { kind: 'decoration', title: { ru: 'Оформление зала', kk: 'Залды безендіру' }, unit: 'усл.', unitPrice: Money.tenge(250_000), quantity: 1 },
    ],
    discount: { type: 'percent', bp: 500 },
    serviceChargeBp: 1000,
    notes: 'Демо-смета. Напитки — по меню бара.',
  });
  ctx.log(`Демо-заявка на банкет ${request.number}`);
};
