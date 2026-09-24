import { GuestTemplate, NotificationChannel, StaffTemplate } from '../public';
import { Locale } from '../../../shared/kernel/translatable';
import { TemplateKey } from './templates';

/**
 * Стартовые тексты шаблонов (ru и kk) для каждого ключа контракта и канала.
 * Сид записывает их в notifications.templates, администратор редактирует в админке;
 * если записи в БД нет — используется текст отсюда.
 *
 * WhatsApp: текст должен совпадать с шаблоном, одобренным в WhatsApp Business (Meta);
 * переменные передаются параметрами (соответствие — в настройках notifications.whatsapp).
 * SMS: коротко, по возможности до 160 символов. Email: тема + текст (HTML строится из текста).
 */
export interface TemplateText {
  subject?: string | null;
  body: string;
}

type LocaleTexts = Record<'ru' | 'kk', TemplateText>;
type EmailTexts = Record<'ru' | 'kk', { subject: string; body: string }>;
interface GuestTexts {
  whatsapp: LocaleTexts;
  sms: LocaleTexts;
  email: EmailTexts;
}
interface StaffTexts {
  whatsapp: LocaleTexts;
  telegram: LocaleTexts;
}

const GUEST: { [K in GuestTemplate]: GuestTexts } = {
  'otp.code': {
    whatsapp: {
      ru: { body: 'Код подтверждения AULA: {{code}}. Никому не сообщайте этот код.' },
      kk: { body: 'AULA растау коды: {{code}}. Бұл кодты ешкімге айтпаңыз.' },
    },
    sms: {
      ru: { body: 'AULA: код {{code}}. Никому не сообщайте.' },
      kk: { body: 'AULA: коды {{code}}. Ешкімге айтпаңыз.' },
    },
    email: {
      ru: {
        subject: 'Код подтверждения AULA',
        body: 'Ваш код подтверждения: {{code}}\n\nНикому не сообщайте этот код. Если вы не запрашивали код, просто проигнорируйте это письмо.',
      },
      kk: {
        subject: 'AULA растау коды',
        body: 'Сіздің растау кодыңыз: {{code}}\n\nБұл кодты ешкімге айтпаңыз. Егер код сұрамаған болсаңыз, бұл хатқа назар аудармаңыз.',
      },
    },
  },
  'order.created': {
    whatsapp: {
      ru: { body: 'Заказ №{{number}} оформлен в {{branchName}}. Сумма: {{total}}. Статус заказа: {{trackingUrl}}' },
      kk: { body: '{{branchName}} мейрамханасында №{{number}} тапсырыс рәсімделді. Сомасы: {{total}}. Тапсырыс күйі: {{trackingUrl}}' },
    },
    sms: {
      ru: { body: 'AULA: заказ {{number}} оформлен, {{total}}. Статус: {{trackingUrl}}' },
      kk: { body: 'AULA: {{number}} тапсырыс рәсімделді, {{total}}. Күйі: {{trackingUrl}}' },
    },
    email: {
      ru: {
        subject: 'Заказ №{{number}} оформлен',
        body:
          'Здравствуйте!\n\nВаш заказ №{{number}} в {{branchName}} оформлен.\nСумма: {{total}}\n\n' +
          'Следить за статусом заказа: {{trackingUrl}}\n\nСпасибо, что выбираете AULA!',
      },
      kk: {
        subject: '№{{number}} тапсырыс рәсімделді',
        body:
          'Сәлеметсіз бе!\n\n{{branchName}} мейрамханасындағы №{{number}} тапсырысыңыз рәсімделді.\nСомасы: {{total}}\n\n' +
          'Тапсырыс күйін бақылау: {{trackingUrl}}\n\nAULA-ны таңдағаныңызға рахмет!',
      },
    },
  },
  'order.paid': {
    whatsapp: {
      ru: { body: 'Оплата заказа №{{number}} на сумму {{total}} получена. Ресторан скоро подтвердит заказ. Статус: {{trackingUrl}}' },
      kk: { body: '№{{number}} тапсырыс үшін {{total}} төлем қабылданды. Мейрамхана тапсырысты жақын арада растайды. Күйі: {{trackingUrl}}' },
    },
    sms: {
      ru: { body: 'AULA: оплата {{total}} по заказу {{number}} получена. {{trackingUrl}}' },
      kk: { body: 'AULA: {{number}} тапсырыс бойынша {{total}} төлем алынды. {{trackingUrl}}' },
    },
    email: {
      ru: {
        subject: 'Оплата заказа №{{number}} получена',
        body:
          'Здравствуйте!\n\nМы получили оплату заказа №{{number}} на сумму {{total}}. Ресторан скоро подтвердит заказ.\n\n' +
          'Статус заказа: {{trackingUrl}}',
      },
      kk: {
        subject: '№{{number}} тапсырыстың төлемі алынды',
        body:
          'Сәлеметсіз бе!\n\n№{{number}} тапсырыс үшін {{total}} сомасындағы төлемді алдық. Мейрамхана тапсырысты жақын арада растайды.\n\n' +
          'Тапсырыс күйі: {{trackingUrl}}',
      },
    },
  },
  'order.accepted': {
    whatsapp: {
      ru: { body: 'Заказ №{{number}} принят и скоро начнёт готовиться. Ориентировочное время: {{eta}}. Статус: {{trackingUrl}}' },
      kk: { body: '№{{number}} тапсырыс қабылданды, жақын арада дайындала бастайды. Болжамды уақыт: {{eta}}. Күйі: {{trackingUrl}}' },
    },
    sms: {
      ru: { body: 'AULA: заказ {{number}} принят, ориентировочно {{eta}}. {{trackingUrl}}' },
      kk: { body: 'AULA: {{number}} тапсырыс қабылданды, болжамды уақыт {{eta}}. {{trackingUrl}}' },
    },
    email: {
      ru: {
        subject: 'Заказ №{{number}} принят',
        body: 'Здравствуйте!\n\nРесторан принял ваш заказ №{{number}}.\nОриентировочное время: {{eta}}\n\nСтатус заказа: {{trackingUrl}}',
      },
      kk: {
        subject: '№{{number}} тапсырыс қабылданды',
        body: 'Сәлеметсіз бе!\n\nМейрамхана №{{number}} тапсырысыңызды қабылдады.\nБолжамды уақыт: {{eta}}\n\nТапсырыс күйі: {{trackingUrl}}',
      },
    },
  },
  'order.ready': {
    whatsapp: {
      ru: { body: 'Заказ №{{number}} готов! Ждём вас: {{branchName}}, {{branchAddress}}. Статус: {{trackingUrl}}' },
      kk: { body: '№{{number}} тапсырыс дайын! Сізді күтеміз: {{branchName}}, {{branchAddress}}. Күйі: {{trackingUrl}}' },
    },
    sms: {
      ru: { body: 'AULA: заказ {{number}} готов. Ждём вас: {{branchAddress}}' },
      kk: { body: 'AULA: {{number}} тапсырыс дайын. Сізді күтеміз: {{branchAddress}}' },
    },
    email: {
      ru: {
        subject: 'Заказ №{{number}} готов',
        body: 'Здравствуйте!\n\nВаш заказ №{{number}} готов. Ждём вас по адресу: {{branchName}}, {{branchAddress}}\n\nСтатус заказа: {{trackingUrl}}',
      },
      kk: {
        subject: '№{{number}} тапсырыс дайын',
        body: 'Сәлеметсіз бе!\n\n№{{number}} тапсырысыңыз дайын. Сізді мына мекенжайда күтеміз: {{branchName}}, {{branchAddress}}\n\nТапсырыс күйі: {{trackingUrl}}',
      },
    },
  },
  'order.delivering': {
    whatsapp: {
      ru: { body: 'Заказ №{{number}} передан курьеру и уже в пути. Отслеживать: {{trackingUrl}}' },
      kk: { body: '№{{number}} тапсырыс курьерге берілді, жолда келеді. Бақылау: {{trackingUrl}}' },
    },
    sms: {
      ru: { body: 'AULA: заказ {{number}} в пути. {{trackingUrl}}' },
      kk: { body: 'AULA: {{number}} тапсырыс жолда. {{trackingUrl}}' },
    },
    email: {
      ru: {
        subject: 'Заказ №{{number}} в пути',
        body: 'Здравствуйте!\n\nЗаказ №{{number}} передан курьеру и уже едет к вам.\n\nОтслеживать заказ: {{trackingUrl}}',
      },
      kk: {
        subject: '№{{number}} тапсырыс жолда',
        body: 'Сәлеметсіз бе!\n\n№{{number}} тапсырыс курьерге берілді және сізге қарай келе жатыр.\n\nТапсырысты бақылау: {{trackingUrl}}',
      },
    },
  },
  'order.completed': {
    whatsapp: {
      ru: { body: 'Заказ №{{number}} выполнен. Спасибо, что выбрали AULA! Приятного аппетита!' },
      kk: { body: '№{{number}} тапсырыс орындалды. AULA-ны таңдағаныңызға рахмет! Ас болсын!' },
    },
    sms: {
      ru: { body: 'AULA: заказ {{number}} выполнен. Спасибо! Приятного аппетита!' },
      kk: { body: 'AULA: {{number}} тапсырыс орындалды. Рахмет! Ас болсын!' },
    },
    email: {
      ru: {
        subject: 'Заказ №{{number}} выполнен',
        body: 'Здравствуйте!\n\nЗаказ №{{number}} выполнен. Спасибо, что выбрали AULA!\n\nПриятного аппетита и до новых встреч.',
      },
      kk: {
        subject: '№{{number}} тапсырыс орындалды',
        body: 'Сәлеметсіз бе!\n\n№{{number}} тапсырыс орындалды. AULA-ны таңдағаныңызға рахмет!\n\nАс болсын, сізді тағы күтеміз.',
      },
    },
  },
  'order.cancelled': {
    whatsapp: {
      ru: { body: 'Заказ №{{number}} отменён. Причина: {{reason}}. Если заказ был оплачен онлайн, мы вернём деньги.' },
      kk: { body: '№{{number}} тапсырыс жойылды. Себебі: {{reason}}. Тапсырыс онлайн төленген болса, ақша қайтарылады.' },
    },
    sms: {
      ru: { body: 'AULA: заказ {{number}} отменён. {{reason}}' },
      kk: { body: 'AULA: {{number}} тапсырыс жойылды. {{reason}}' },
    },
    email: {
      ru: {
        subject: 'Заказ №{{number}} отменён',
        body:
          'Здравствуйте!\n\nК сожалению, заказ №{{number}} отменён.\nПричина: {{reason}}\n\n' +
          'Если заказ был оплачен онлайн, мы вернём деньги тем же способом оплаты.',
      },
      kk: {
        subject: '№{{number}} тапсырыс жойылды',
        body:
          'Сәлеметсіз бе!\n\nӨкінішке қарай, №{{number}} тапсырыс жойылды.\nСебебі: {{reason}}\n\n' +
          'Тапсырыс онлайн төленген болса, ақша сол төлем тәсілімен қайтарылады.',
      },
    },
  },
  'order.refunded': {
    whatsapp: {
      ru: { body: 'По заказу №{{number}} оформлен возврат {{amount}}. Срок зачисления зависит от банка.' },
      kk: { body: '№{{number}} тапсырыс бойынша {{amount}} қайтарылды. Ақшаның түсу мерзімі банкке байланысты.' },
    },
    sms: {
      ru: { body: 'AULA: возврат {{amount}} по заказу {{number}} оформлен.' },
      kk: { body: 'AULA: {{number}} тапсырыс бойынша {{amount}} қайтарылды.' },
    },
    email: {
      ru: {
        subject: 'Возврат по заказу №{{number}}',
        body: 'Здравствуйте!\n\nПо заказу №{{number}} оформлен возврат на сумму {{amount}}.\nСрок зачисления средств зависит от вашего банка.',
      },
      kk: {
        subject: '№{{number}} тапсырыс бойынша қайтарым',
        body: 'Сәлеметсіз бе!\n\n№{{number}} тапсырыс бойынша {{amount}} сомасы қайтарылды.\nАқшаның шотқа түсу мерзімі банкіңізге байланысты.',
      },
    },
  },
  'reservation.pending': {
    whatsapp: {
      ru: {
        body:
          'Заявка на бронь №{{number}} получена: {{branchName}}, {{date}} в {{time}}, гостей: {{guests}}. ' +
          'Мы подтвердим бронь в ближайшее время. Управление бронью: {{manageUrl}}',
      },
      kk: {
        body:
          '№{{number}} брондау өтінімі қабылданды: {{branchName}}, {{date}}, сағат {{time}}, қонақ саны: {{guests}}. ' +
          'Брондауды жақын арада растаймыз. Брондауды басқару: {{manageUrl}}',
      },
    },
    sms: {
      ru: { body: 'AULA: бронь {{number}} на {{date}} {{time}} ждёт подтверждения. {{manageUrl}}' },
      kk: { body: 'AULA: {{date}} {{time}} брондауы ({{number}}) расталуды күтуде. {{manageUrl}}' },
    },
    email: {
      ru: {
        subject: 'Заявка на бронь №{{number}} получена',
        body:
          'Здравствуйте!\n\nМы получили заявку на бронь №{{number}}.\nРесторан: {{branchName}}\nДата и время: {{date}}, {{time}}\n' +
          'Гостей: {{guests}}\n\nАдминистратор подтвердит бронь в ближайшее время.\nУправление бронью: {{manageUrl}}',
      },
      kk: {
        subject: '№{{number}} брондау өтінімі қабылданды',
        body:
          'Сәлеметсіз бе!\n\n№{{number}} брондау өтініміңізді алдық.\nМейрамхана: {{branchName}}\nКүні мен уақыты: {{date}}, {{time}}\n' +
          'Қонақ саны: {{guests}}\n\nӘкімші брондауды жақын арада растайды.\nБрондауды басқару: {{manageUrl}}',
      },
    },
  },
  'reservation.awaiting_deposit': {
    whatsapp: {
      ru: {
        body:
          'Бронь №{{number}} ({{branchName}}, {{date}} в {{time}}) ждёт оплаты депозита {{deposit}}. ' +
          'Оплатите до {{holdUntil}}, иначе бронь будет снята: {{paymentUrl}}',
      },
      kk: {
        body:
          '№{{number}} брондау ({{branchName}}, {{date}}, сағат {{time}}) {{deposit}} депозит төлемін күтуде. ' +
          '{{holdUntil}} дейін төлеңіз, әйтпесе брондау жойылады: {{paymentUrl}}',
      },
    },
    sms: {
      ru: { body: 'AULA: оплатите депозит {{deposit}} по брони {{number}} до {{holdUntil}}: {{paymentUrl}}' },
      kk: { body: 'AULA: {{number}} брондау депозитін ({{deposit}}) {{holdUntil}} дейін төлеңіз: {{paymentUrl}}' },
    },
    email: {
      ru: {
        subject: 'Оплатите депозит по брони №{{number}}',
        body:
          'Здравствуйте!\n\nБронь №{{number}} ждёт оплаты депозита.\nРесторан: {{branchName}}\nДата и время: {{date}}, {{time}}\n' +
          'Депозит: {{deposit}}\n\nОплатите депозит до {{holdUntil}}, иначе бронь будет снята. Ссылка на оплату: {{paymentUrl}}\n\n' +
          'Депозит засчитывается в счёт.',
      },
      kk: {
        subject: '№{{number}} брондау бойынша депозитті төлеңіз',
        body:
          'Сәлеметсіз бе!\n\n№{{number}} брондау депозит төлемін күтуде.\nМейрамхана: {{branchName}}\nКүні мен уақыты: {{date}}, {{time}}\n' +
          'Депозит: {{deposit}}\n\nДепозитті {{holdUntil}} дейін төлеңіз, әйтпесе брондау жойылады. Төлем сілтемесі: {{paymentUrl}}\n\n' +
          'Депозит шот сомасына есептеледі.',
      },
    },
  },
  'reservation.confirmed': {
    whatsapp: {
      ru: {
        body:
          'Бронь №{{number}} подтверждена! {{branchName}}, {{venueName}}, {{date}} в {{time}}, гостей: {{guests}}. ' +
          'Адрес: {{branchAddress}}. Изменить или отменить: {{manageUrl}}',
      },
      kk: {
        body:
          '№{{number}} брондау расталды! {{branchName}}, {{venueName}}, {{date}}, сағат {{time}}, қонақ саны: {{guests}}. ' +
          'Мекенжай: {{branchAddress}}. Өзгерту немесе бас тарту: {{manageUrl}}',
      },
    },
    sms: {
      ru: { body: 'AULA: бронь {{number}} подтверждена, {{date}} {{time}}, {{branchAddress}}. {{manageUrl}}' },
      kk: { body: 'AULA: {{number}} брондау расталды, {{date}} {{time}}, {{branchAddress}}. {{manageUrl}}' },
    },
    email: {
      ru: {
        subject: 'Бронь №{{number}} подтверждена',
        body:
          'Здравствуйте!\n\nВаша бронь №{{number}} подтверждена.\nРесторан: {{branchName}}\nАдрес: {{branchAddress}}\nЗал: {{venueName}}\n' +
          'Дата и время: {{date}}, {{time}}\nГостей: {{guests}}\n\nИзменить или отменить бронь: {{manageUrl}}\n\nЖдём вас в AULA!',
      },
      kk: {
        subject: '№{{number}} брондау расталды',
        body:
          'Сәлеметсіз бе!\n\n№{{number}} брондауыңыз расталды.\nМейрамхана: {{branchName}}\nМекенжай: {{branchAddress}}\nЗал: {{venueName}}\n' +
          'Күні мен уақыты: {{date}}, {{time}}\nҚонақ саны: {{guests}}\n\nБрондауды өзгерту немесе одан бас тарту: {{manageUrl}}\n\n' +
          'Сізді AULA-да күтеміз!',
      },
    },
  },
  'reservation.reminder': {
    whatsapp: {
      ru: {
        body: 'Напоминаем о брони №{{number}}: {{branchName}}, {{date}} в {{time}}. Адрес: {{branchAddress}}. Если планы изменились: {{manageUrl}}',
      },
      kk: {
        body:
          '№{{number}} брондау туралы еске саламыз: {{branchName}}, {{date}}, сағат {{time}}. Мекенжай: {{branchAddress}}. ' +
          'Жоспарыңыз өзгерсе: {{manageUrl}}',
      },
    },
    sms: {
      ru: { body: 'AULA: ждём вас {{date}} в {{time}}, {{branchAddress}}. Бронь {{number}}. {{manageUrl}}' },
      kk: { body: 'AULA: сізді {{date}}, сағат {{time}} күтеміз, {{branchAddress}}. Брондау {{number}}. {{manageUrl}}' },
    },
    email: {
      ru: {
        subject: 'Напоминание о брони №{{number}}',
        body:
          'Здравствуйте!\n\nНапоминаем о вашей брони №{{number}}.\nРесторан: {{branchName}}\nАдрес: {{branchAddress}}\n' +
          'Дата и время: {{date}}, {{time}}\n\nЕсли планы изменились, измените или отмените бронь: {{manageUrl}}',
      },
      kk: {
        subject: '№{{number}} брондау туралы еске салу',
        body:
          'Сәлеметсіз бе!\n\n№{{number}} брондауыңыз туралы еске саламыз.\nМейрамхана: {{branchName}}\nМекенжай: {{branchAddress}}\n' +
          'Күні мен уақыты: {{date}}, {{time}}\n\nЖоспарыңыз өзгерсе, брондауды өзгертіңіз немесе одан бас тартыңыз: {{manageUrl}}',
      },
    },
  },
  'reservation.cancelled': {
    whatsapp: {
      ru: { body: 'Бронь №{{number}} на {{date}} в {{time}} отменена. {{depositNote}}' },
      kk: { body: '{{date}}, сағат {{time}} арналған №{{number}} брондау жойылды. {{depositNote}}' },
    },
    sms: {
      ru: { body: 'AULA: бронь {{number}} на {{date}} {{time}} отменена. {{depositNote}}' },
      kk: { body: 'AULA: {{date}} {{time}} брондауы ({{number}}) жойылды. {{depositNote}}' },
    },
    email: {
      ru: {
        subject: 'Бронь №{{number}} отменена',
        body: 'Здравствуйте!\n\nБронь №{{number}} на {{date}}, {{time}} отменена.\n{{depositNote}}\n\nБудем рады видеть вас в AULA в другой раз.',
      },
      kk: {
        subject: '№{{number}} брондау жойылды',
        body: 'Сәлеметсіз бе!\n\n{{date}}, {{time}} арналған №{{number}} брондау жойылды.\n{{depositNote}}\n\nСізді AULA-да басқа уақытта күтеміз.',
      },
    },
  },
  'reservation.expired': {
    whatsapp: {
      ru: {
        body: 'Бронь №{{number}} на {{date}} в {{time}} снята: она не была подтверждена или оплачена вовремя. Забронировать заново можно на сайте AULA.',
      },
      kk: {
        body:
          '{{date}}, сағат {{time}} арналған №{{number}} брондау уақытында расталмағандықтан немесе төленбегендіктен жойылды. ' +
          'AULA сайтында қайта брондауға болады.',
      },
    },
    sms: {
      ru: { body: 'AULA: бронь {{number}} на {{date}} {{time}} снята - не подтверждена вовремя.' },
      kk: { body: 'AULA: {{date}} {{time}} брондауы ({{number}}) уақытында расталмай, жойылды.' },
    },
    email: {
      ru: {
        subject: 'Бронь №{{number}} снята',
        body:
          'Здравствуйте!\n\nБронь №{{number}} на {{date}}, {{time}} снята, так как она не была подтверждена или оплачена вовремя.\n\n' +
          'Вы можете оформить новую бронь на сайте AULA.',
      },
      kk: {
        subject: '№{{number}} брондау жойылды',
        body:
          'Сәлеметсіз бе!\n\n{{date}}, {{time}} арналған №{{number}} брондау уақытында расталмағандықтан немесе төленбегендіктен жойылды.\n\n' +
          'AULA сайтында жаңа брондау рәсімдеуге болады.',
      },
    },
  },
  'banquet.request_received': {
    whatsapp: {
      ru: { body: 'Заявка на банкет №{{number}} принята! Ваш менеджер: {{managerName}}, {{managerPhone}}. Мы свяжемся с вами в ближайшее время.' },
      kk: { body: '№{{number}} банкет өтінімі қабылданды! Сіздің менеджеріңіз: {{managerName}}, {{managerPhone}}. Жақын арада сізбен хабарласамыз.' },
    },
    sms: {
      ru: { body: 'AULA: заявка на банкет {{number}} принята. Менеджер {{managerName}}, {{managerPhone}}' },
      kk: { body: 'AULA: {{number}} банкет өтінімі қабылданды. Менеджер {{managerName}}, {{managerPhone}}' },
    },
    email: {
      ru: {
        subject: 'Заявка на банкет №{{number}} принята',
        body:
          'Здравствуйте!\n\nСпасибо за заявку на банкет в AULA. Номер заявки: {{number}}.\n\n' +
          'Ваш персональный менеджер: {{managerName}}, {{managerPhone}}.\nМы свяжемся с вами в ближайшее время, чтобы обсудить детали.',
      },
      kk: {
        subject: '№{{number}} банкет өтінімі қабылданды',
        body:
          'Сәлеметсіз бе!\n\nAULA-дағы банкетке өтінім бергеніңізге рахмет. Өтінім нөмірі: {{number}}.\n\n' +
          'Сіздің жеке менеджеріңіз: {{managerName}}, {{managerPhone}}.\nЕгжей-тегжейін талқылау үшін жақын арада сізбен хабарласамыз.',
      },
    },
  },
  'banquet.quote_sent': {
    whatsapp: {
      ru: { body: 'Смета по банкету №{{number}} готова: {{total}}. Посмотреть и согласовать: {{quoteUrl}}. Ваш менеджер: {{managerName}}.' },
      kk: { body: '№{{number}} банкет сметасы дайын: {{total}}. Қарап шығу және келісу: {{quoteUrl}}. Сіздің менеджеріңіз: {{managerName}}.' },
    },
    sms: {
      ru: { body: 'AULA: смета по банкету {{number}} на {{total}}: {{quoteUrl}}' },
      kk: { body: 'AULA: {{number}} банкет сметасы, {{total}}: {{quoteUrl}}' },
    },
    email: {
      ru: {
        subject: 'Смета по банкету №{{number}}',
        body:
          'Здравствуйте!\n\nМы подготовили смету по банкету №{{number}}.\nИтого: {{total}}\n\nПосмотреть и согласовать смету: {{quoteUrl}}\n\n' +
          'Если нужно что-то изменить, свяжитесь с вашим менеджером: {{managerName}}.',
      },
      kk: {
        subject: '№{{number}} банкет сметасы',
        body:
          'Сәлеметсіз бе!\n\n№{{number}} банкет бойынша смета дайындадық.\nБарлығы: {{total}}\n\nСметаны қарап шығу және келісу: {{quoteUrl}}\n\n' +
          'Бір нәрсені өзгерту қажет болса, менеджеріңізбен хабарласыңыз: {{managerName}}.',
      },
    },
  },
  'banquet.invoice_issued': {
    whatsapp: {
      ru: { body: 'По банкету №{{number}} выставлен счёт №{{invoiceNumber}} на {{amount}}. Оплатить до {{dueDate}}: {{paymentUrl}}' },
      kk: { body: '№{{number}} банкет бойынша {{amount}} сомасына №{{invoiceNumber}} шот жазылды. {{dueDate}} дейін төлеу: {{paymentUrl}}' },
    },
    sms: {
      ru: { body: 'AULA: счёт {{invoiceNumber}} на {{amount}}, оплатить до {{dueDate}}: {{paymentUrl}}' },
      kk: { body: 'AULA: {{invoiceNumber}} шот, {{amount}}, {{dueDate}} дейін төлеңіз: {{paymentUrl}}' },
    },
    email: {
      ru: {
        subject: 'Счёт №{{invoiceNumber}} по банкету №{{number}}',
        body:
          'Здравствуйте!\n\nПо банкету №{{number}} выставлен счёт №{{invoiceNumber}}.\nСумма: {{amount}}\nОплатить до: {{dueDate}}\n' +
          'Ссылка на оплату: {{paymentUrl}}',
      },
      kk: {
        subject: '№{{number}} банкет бойынша №{{invoiceNumber}} шот',
        body:
          'Сәлеметсіз бе!\n\n№{{number}} банкет бойынша №{{invoiceNumber}} шот жазылды.\nСомасы: {{amount}}\nТөлеу мерзімі: {{dueDate}}\n' +
          'Төлем сілтемесі: {{paymentUrl}}',
      },
    },
  },
  'banquet.payment_received': {
    whatsapp: {
      ru: { body: 'Получили оплату {{amount}} по банкету №{{number}}. Остаток к оплате: {{remaining}}. Спасибо!' },
      kk: { body: '№{{number}} банкет бойынша {{amount}} төлем алынды. Төленетін қалдық: {{remaining}}. Рахмет!' },
    },
    sms: {
      ru: { body: 'AULA: оплата {{amount}} по банкету {{number}} получена. Остаток: {{remaining}}' },
      kk: { body: 'AULA: {{number}} банкет бойынша {{amount}} төлем алынды. Қалдық: {{remaining}}' },
    },
    email: {
      ru: {
        subject: 'Оплата по банкету №{{number}} получена',
        body: 'Здравствуйте!\n\nМы получили оплату по банкету №{{number}}.\nСумма платежа: {{amount}}\nОстаток к оплате: {{remaining}}\n\nСпасибо!',
      },
      kk: {
        subject: '№{{number}} банкет бойынша төлем алынды',
        body: 'Сәлеметсіз бе!\n\n№{{number}} банкет бойынша төлемді алдық.\nТөлем сомасы: {{amount}}\nТөленетін қалдық: {{remaining}}\n\nРахмет!',
      },
    },
  },
  'certificate.issued': {
    whatsapp: {
      ru: {
        body:
          'Вам подарочный сертификат AULA на {{nominal}}! Код: {{code}}, действует до {{expiresAt}}. ' +
          'Назовите код в ресторане или введите при заказе на сайте. {{message}}',
      },
      kk: {
        body:
          'Сізге {{nominal}} сомасына AULA сыйлық сертификаты! Коды: {{code}}, {{expiresAt}} дейін жарамды. ' +
          'Кодты мейрамханада айтыңыз немесе сайтта тапсырыс бергенде енгізіңіз. {{message}}',
      },
    },
    sms: {
      ru: { body: 'AULA: сертификат на {{nominal}}, код {{code}}, до {{expiresAt}}' },
      kk: { body: 'AULA: {{nominal}} сертификат, коды {{code}}, {{expiresAt}} дейін' },
    },
    email: {
      ru: {
        subject: 'Подарочный сертификат AULA на {{nominal}}',
        body:
          'Здравствуйте!\n\nВам подарочный сертификат AULA на {{nominal}}.\nПолучатель: {{recipientName}}\nКод сертификата: {{code}}\n' +
          'Действует до: {{expiresAt}}\nПожелание: {{message}}\n\n' +
          'Назовите код при оплате в ресторане или введите его при оформлении заказа на сайте AULA. Сертификат — во вложении.',
      },
      kk: {
        subject: 'AULA сыйлық сертификаты: {{nominal}}',
        body:
          'Сәлеметсіз бе!\n\nСізге {{nominal}} сомасына AULA сыйлық сертификаты.\nАлушы: {{recipientName}}\nСертификат коды: {{code}}\n' +
          'Жарамдылық мерзімі: {{expiresAt}}\nТілек: {{message}}\n\n' +
          'Кодты мейрамханада төлеген кезде айтыңыз немесе AULA сайтында тапсырыс рәсімдегенде енгізіңіз. Сертификат хатқа тіркелген.',
      },
    },
  },
  'certificate.redeemed': {
    whatsapp: {
      ru: { body: 'С сертификата AULA списано {{amount}}. Остаток: {{balance}}.' },
      kk: { body: 'AULA сертификатынан {{amount}} есептен шығарылды. Қалдық: {{balance}}.' },
    },
    sms: {
      ru: { body: 'AULA: с сертификата списано {{amount}}, остаток {{balance}}' },
      kk: { body: 'AULA: сертификаттан {{amount}} шығарылды, қалдық {{balance}}' },
    },
    email: {
      ru: {
        subject: 'Списание с сертификата AULA',
        body: 'Здравствуйте!\n\nС вашего подарочного сертификата AULA списано {{amount}}.\nОстаток на сертификате: {{balance}}',
      },
      kk: {
        subject: 'AULA сертификатынан есептен шығару',
        body: 'Сәлеметсіз бе!\n\nAULA сыйлық сертификатыңыздан {{amount}} есептен шығарылды.\nСертификаттағы қалдық: {{balance}}',
      },
    },
  },
};

const STAFF: { [K in StaffTemplate]: StaffTexts } = {
  'staff.order_new': {
    whatsapp: {
      ru: { body: 'Новый заказ №{{number}} ({{type}}) в {{branchName}} на {{total}}. Открыть: {{adminUrl}}' },
      kk: { body: 'Жаңа тапсырыс №{{number}} ({{type}}), {{branchName}}, сомасы {{total}}. Ашу: {{adminUrl}}' },
    },
    telegram: {
      ru: { body: 'Новый заказ №{{number}}\nТип: {{type}}\nФилиал: {{branchName}}\nСумма: {{total}}\nОткрыть: {{adminUrl}}' },
      kk: { body: 'Жаңа тапсырыс №{{number}}\nТүрі: {{type}}\nФилиал: {{branchName}}\nСомасы: {{total}}\nАшу: {{adminUrl}}' },
    },
  },
  'staff.order_paid': {
    whatsapp: {
      ru: { body: 'Заказ №{{number}} оплачен ({{total}}). Примите заказ: {{adminUrl}}' },
      kk: { body: '№{{number}} тапсырыс төленді ({{total}}). Тапсырысты қабылдаңыз: {{adminUrl}}' },
    },
    telegram: {
      ru: { body: 'Заказ №{{number}} оплачен\nСумма: {{total}}\nПримите заказ: {{adminUrl}}' },
      kk: { body: '№{{number}} тапсырыс төленді\nСомасы: {{total}}\nТапсырысты қабылдаңыз: {{adminUrl}}' },
    },
  },
  'staff.reservation_new': {
    whatsapp: {
      ru: { body: 'Новая бронь №{{number}}: {{date}} в {{time}}, {{venueName}}, гостей: {{guests}}. Открыть: {{adminUrl}}' },
      kk: { body: 'Жаңа брондау №{{number}}: {{date}}, сағат {{time}}, {{venueName}}, қонақ саны: {{guests}}. Ашу: {{adminUrl}}' },
    },
    telegram: {
      ru: { body: 'Новая бронь №{{number}}\nДата и время: {{date}}, {{time}}\nЗал: {{venueName}}\nГостей: {{guests}}\nОткрыть: {{adminUrl}}' },
      kk: { body: 'Жаңа брондау №{{number}}\nКүні мен уақыты: {{date}}, {{time}}\nЗал: {{venueName}}\nҚонақ саны: {{guests}}\nАшу: {{adminUrl}}' },
    },
  },
  'staff.reservation_cancelled': {
    whatsapp: {
      ru: { body: 'Бронь №{{number}} на {{date}} в {{time}} отменена.' },
      kk: { body: '{{date}}, сағат {{time}} арналған №{{number}} брондау жойылды.' },
    },
    telegram: {
      ru: { body: 'Бронь №{{number}} отменена\nДата и время: {{date}}, {{time}}' },
      kk: { body: '№{{number}} брондау жойылды\nКүні мен уақыты: {{date}}, {{time}}' },
    },
  },
  'staff.banquet_new': {
    whatsapp: {
      ru: {
        body: 'Новая банкетная заявка №{{number}}: {{eventDate}}, гостей: {{guests}}, бюджет: {{budget}}. Менеджер: {{managerName}}. Открыть: {{adminUrl}}',
      },
      kk: {
        body: 'Жаңа банкет өтінімі №{{number}}: {{eventDate}}, қонақ саны: {{guests}}, бюджеті: {{budget}}. Менеджер: {{managerName}}. Ашу: {{adminUrl}}',
      },
    },
    telegram: {
      ru: {
        body: 'Новая банкетная заявка №{{number}}\nДата: {{eventDate}}\nГостей: {{guests}}\nБюджет: {{budget}}\nМенеджер: {{managerName}}\nОткрыть: {{adminUrl}}',
      },
      kk: {
        body: 'Жаңа банкет өтінімі №{{number}}\nКүні: {{eventDate}}\nҚонақ саны: {{guests}}\nБюджеті: {{budget}}\nМенеджер: {{managerName}}\nАшу: {{adminUrl}}',
      },
    },
  },
  'staff.banquet_assigned': {
    whatsapp: {
      ru: { body: 'Вам назначена банкетная заявка №{{number}} на {{eventDate}}. Ответьте гостю в течение 30 минут: {{adminUrl}}' },
      kk: { body: 'Сізге {{eventDate}} күнгі №{{number}} банкет өтінімі тағайындалды. Қонаққа 30 минут ішінде жауап беріңіз: {{adminUrl}}' },
    },
    telegram: {
      ru: { body: 'Вам назначена банкетная заявка №{{number}}\nДата мероприятия: {{eventDate}}\nОтветьте гостю в течение 30 минут: {{adminUrl}}' },
      kk: { body: 'Сізге №{{number}} банкет өтінімі тағайындалды\nІс-шара күні: {{eventDate}}\nҚонаққа 30 минут ішінде жауап беріңіз: {{adminUrl}}' },
    },
  },
  'staff.banquet_sla_breach': {
    whatsapp: {
      ru: { body: 'Заявка на банкет №{{number}} без ответа уже {{minutes}} мин. Менеджер: {{managerName}}. Открыть: {{adminUrl}}' },
      kk: { body: '№{{number}} банкет өтініміне {{minutes}} минуттан бері жауап жоқ. Менеджер: {{managerName}}. Ашу: {{adminUrl}}' },
    },
    telegram: {
      ru: { body: 'Просрочен ответ по банкетной заявке №{{number}}\nБез ответа: {{minutes}} мин\nМенеджер: {{managerName}}\nОткрыть: {{adminUrl}}' },
      kk: { body: '№{{number}} банкет өтінімі бойынша жауап мерзімі өтті\nЖауапсыз: {{minutes}} мин\nМенеджер: {{managerName}}\nАшу: {{adminUrl}}' },
    },
  },
  'staff.daily_report': {
    whatsapp: {
      ru: { body: 'Отчёт AULA за {{date}}: {{summary}}. Подробнее: {{adminUrl}}' },
      kk: { body: 'AULA {{date}} есебі: {{summary}}. Толығырақ: {{adminUrl}}' },
    },
    telegram: {
      ru: { body: 'Отчёт AULA за {{date}}\n{{summary}}\nПодробнее: {{adminUrl}}' },
      kk: { body: 'AULA {{date}} есебі\n{{summary}}\nТолығырақ: {{adminUrl}}' },
    },
  },
  'staff.system_alert': {
    whatsapp: {
      ru: { body: 'Системное оповещение AULA: {{title}}. {{details}}' },
      kk: { body: 'AULA жүйелік хабарламасы: {{title}}. {{details}}' },
    },
    telegram: {
      ru: { body: 'Системное оповещение AULA\n{{title}}\n{{details}}' },
      kk: { body: 'AULA жүйелік хабарламасы\n{{title}}\n{{details}}' },
    },
  },
  'staff.refund_failed': {
    whatsapp: {
      ru: { body: 'Не удалось выполнить возврат {{amount}} ({{reference}}): {{error}}. Проверьте платёж вручную.' },
      kk: { body: '{{amount}} қайтару орындалмады ({{reference}}): {{error}}. Төлемді қолмен тексеріңіз.' },
    },
    telegram: {
      ru: { body: 'Возврат не выполнен\nСумма: {{amount}}\nОснование: {{reference}}\nОшибка: {{error}}\nПроверьте платёж вручную.' },
      kk: { body: 'Қайтару орындалмады\nСомасы: {{amount}}\nНегіздеме: {{reference}}\nҚате: {{error}}\nТөлемді қолмен тексеріңіз.' },
    },
  },
};

const DEFAULTS: Record<string, Partial<Record<NotificationChannel, Partial<Record<Locale, TemplateText>>>>> = { ...GUEST, ...STAFF };

/** Стартовый текст шаблона для канала и языка (null — нет). */
export function defaultTemplateText(key: TemplateKey | string, channel: NotificationChannel, locale: Locale): TemplateText | null {
  return DEFAULTS[key]?.[channel]?.[locale] ?? null;
}

/** Все стартовые тексты: для сида и проверки полноты. */
export function allDefaultTemplateTexts(): Array<{ key: string; channel: NotificationChannel; locale: Locale; text: TemplateText }> {
  const out: Array<{ key: string; channel: NotificationChannel; locale: Locale; text: TemplateText }> = [];
  for (const [key, channels] of Object.entries(DEFAULTS)) {
    for (const [channel, locales] of Object.entries(channels)) {
      for (const [locale, text] of Object.entries(locales ?? {})) {
        out.push({ key, channel: channel as NotificationChannel, locale: locale as Locale, text: text! });
      }
    }
  }
  return out;
}
