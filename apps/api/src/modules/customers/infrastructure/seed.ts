import { Database } from '../../../shared/infrastructure/database/database';
import { ModuleSeeder } from '../../../shared/infrastructure/seed/seed.types';
import { Clock } from '../../../shared/kernel/clock';
import { newId } from '../../../shared/kernel/ids';
import { Translatable } from '../../../shared/kernel/translatable';
import { RecordConsent } from '../application/consent.actions';
import { IdentifyCustomer } from '../application/identify-customer.action';
import { ConsentKind } from '../public';
import { ConsentTextRepository } from './consent.repository';
import { CustomerRepository } from './customer.repository';

/** Первая редакция текстов согласий. Правится публикацией новой версии в админке. */
export const INITIAL_CONSENT_VERSION = '2026-09-25';

const OPERATOR_RU = 'ТОО «Express kitchen» (сеть ресторанов AULA, г. Астана)';
const OPERATOR_KK = '«Express kitchen» ЖШС (AULA мейрамханалар желісі, Астана қ.)';

export const INITIAL_CONSENT_TEXTS: Array<{ kind: ConsentKind; text: Translatable }> = [
  {
    kind: 'personal_data',
    text: {
      ru:
        `Я даю согласие ${OPERATOR_RU} на сбор и обработку моих персональных данных (имя, номер телефона, ` +
        'адрес электронной почты, адрес доставки, сведения о заказах, бронированиях и мероприятиях) в соответствии ' +
        'с Законом Республики Казахстан от 21 мая 2013 года № 94-V «О персональных данных и их защите» — для оформления ' +
        'и исполнения заказа, бронирования или заявки на мероприятие, связи со мной по ним и ведения истории обслуживания. ' +
        'Данные хранятся на территории Республики Казахстан и передаются третьим лицам только в объёме, необходимом для ' +
        'исполнения заказа (служба доставки, платёжный провайдер, SMS- и мессенджер-сервисы). Согласие действует до его ' +
        'отзыва; отозвать согласие или потребовать удаления данных можно, обратившись в ресторан.',
      kk:
        `Мен ${OPERATOR_KK} ұйымына «Дербес деректер және оларды қорғау туралы» Қазақстан Республикасының ` +
        '2013 жылғы 21 мамырдағы № 94-V Заңына сәйкес дербес деректерімді (аты-жөні, телефон нөмірі, электрондық пошта ' +
        'мекенжайы, жеткізу мекенжайы, тапсырыстар, брондаулар және іс-шаралар туралы мәліметтер) тапсырысты, брондауды ' +
        'немесе іс-шараға өтінімді ресімдеу және орындау, солар бойынша менімен байланысу және қызмет көрсету тарихын жүргізу ' +
        'мақсатында жинауға және өңдеуге келісім беремін. Деректер Қазақстан Республикасының аумағында сақталады және ' +
        'үшінші тұлғаларға тапсырысты орындау үшін қажетті көлемде ғана беріледі (жеткізу қызметі, төлем провайдері, SMS ' +
        'және мессенджер қызметтері). Келісім кері қайтарылғанға дейін қолданылады; келісімді кері қайтару немесе деректерді ' +
        'жоюды талап ету үшін мейрамханаға хабарласуға болады.',
    },
  },
  {
    kind: 'marketing',
    text: {
      ru:
        `Я согласен(на) получать от ${OPERATOR_RU} информацию об акциях, специальных предложениях и мероприятиях ` +
        'по SMS, в WhatsApp и по электронной почте. Согласие добровольное и не влияет на оформление заказа; отказаться ' +
        'от рассылки можно в любой момент, сообщив об этом ресторану.',
      kk:
        `Мен ${OPERATOR_KK} ұйымынан акциялар, арнайы ұсыныстар және іс-шаралар туралы ақпаратты SMS, WhatsApp және ` +
        'электрондық пошта арқылы алуға келісемін. Келісім ерікті және тапсырысты ресімдеуге әсер етпейді; хабарламалардан ' +
        'кез келген уақытта мейрамханаға хабарлап бас тартуға болады.',
    },
  },
];

const DEMO_GUESTS = [
  { phone: '+77010000001', name: 'Айгерим Демо', email: 'aigerim.demo@example.kz', locale: 'kk' as const, marketing: true, tags: ['vip'] },
  { phone: '+77010000002', name: 'Сергей Демо', email: 'sergey.demo@example.kz', locale: 'ru' as const, marketing: false, tags: [] },
  { phone: '+77010000003', name: 'Ерлан Демо (ТОО «Демо»)', email: null, locale: 'ru' as const, marketing: true, tags: ['corporate'] },
];

/**
 * Стартовые данные Customers: тексты согласий (ПД и маркетинг) первой редакции на kk и ru — всегда;
 * демо-гости с согласиями — только в демо-режиме. Идемпотентно: поиск по (вид, версия) и телефону.
 */
export const seedCustomers: ModuleSeeder = async (ctx) => {
  const database = ctx.app.get(Database);
  const texts = ctx.app.get(ConsentTextRepository);
  const clock = ctx.app.get(Clock);

  await database.transaction(async () => {
    for (const item of INITIAL_CONSENT_TEXTS) {
      if (await texts.find(item.kind, INITIAL_CONSENT_VERSION)) continue;
      await texts.insert({
        id: newId(),
        kind: item.kind,
        version: INITIAL_CONSENT_VERSION,
        text: item.text,
        publishedAt: clock.now(),
        publishedBy: null,
      });
      ctx.log(`Текст согласия ${item.kind} v${INITIAL_CONSENT_VERSION} опубликован`);
    }
  });

  if (!ctx.demo) return;
  const identify = ctx.app.get(IdentifyCustomer);
  const recordConsent = ctx.app.get(RecordConsent);
  const customers = ctx.app.get(CustomerRepository);
  for (const guest of DEMO_GUESTS) {
    if (await customers.findByPhone(guest.phone)) continue;
    await database.transaction(async () => {
      const { customerId } = await identify.execute({ phone: guest.phone, name: guest.name, email: guest.email, locale: guest.locale });
      await recordConsent.execute({
        customerId,
        kind: 'personal_data',
        granted: true,
        textVersion: INITIAL_CONSENT_VERSION,
        source: 'web',
      });
      if (guest.marketing) {
        await recordConsent.execute({ customerId, kind: 'marketing', granted: true, textVersion: INITIAL_CONSENT_VERSION, source: 'web' });
      }
      for (const tag of guest.tags) await customers.addTag(customerId, tag);
    });
  }
  ctx.log('Демо-гости созданы');
};
