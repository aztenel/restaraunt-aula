import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { XMLBuilder } from 'fast-xml-parser';
import { Money } from '../../../../../shared/kernel/money';
import { toLocalTime } from '../../../../../shared/kernel/time';
import { translate } from '../../../../../shared/kernel/translatable';
import { AccountingExportArtifact, AccountingExporter } from '../../../application/accounting/accounting-exporter';
import {
  AccountingBranch,
  AccountingCounterparty,
  AccountingExportData,
  AccountingExportFormat,
  AccountingOrganization,
  AccountingPaymentMethod,
} from '../../../domain/accounting-export';
import { averageAmount, formatDecimal } from '../../../domain/amounts';
import { localDateOf, REPORTING_TIMEZONE } from '../../../domain/period';

/**
 * Выгрузка в 1С: XML, близкий к формату EnterpriseData (http://v8.1c.ru/edi/edi_stnd/EnterpriseData/1.8).
 * Документы: отчёт о розничных продажах (день × филиал, позиции, оплаты по видам), продажа
 * подарочных сертификатов, счета на оплату и акты (реализация услуг) по банкетам с контрагентами.
 * Точный состав полей согласуется с бухгалтерией после discovery (docs/decisions.md, вопрос 9).
 */
export const ENTERPRISE_DATA_NS = 'http://v8.1c.ru/edi/edi_stnd/EnterpriseData/1.8';
const MESSAGE_NS = 'http://www.1c.ru/SSL/Exchange/Message';

const PAYMENT_KIND: Record<AccountingPaymentMethod, string> = {
  online: 'ОплатаПлатежнойКартой',
  on_receipt: 'ОплатаПриПолучении',
  gift_certificate: 'ПодарочныйСертификат',
  bank_transfer: 'БезналичныйПеревод',
};

/** Детерминированный UUID (Ссылка) по ключу: повторная выгрузка того же документа даёт ту же ссылку. */
export function stableRef(key: string): string {
  const h = createHash('sha256').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

function amount(m: Money): string {
  return formatDecimal(m.amount);
}

function organization(org: AccountingOrganization | null) {
  return org ? { Наименование: org.name, БИН: org.bin } : { Наименование: 'Не задано' };
}

function warehouse(branch: AccountingBranch | null) {
  return branch ? { Код: branch.code, Наименование: branch.name } : { Код: '', Наименование: 'Без филиала' };
}

function counterparty(c: AccountingCounterparty | null) {
  return c
    ? { Ссылка: stableRef(`counterparty:${c.bin}`), Наименование: c.name, БИН: c.bin, ЮридическоеФизическоеЛицо: 'ЮридическоеЛицо' }
    : { Наименование: 'Физическое лицо', ЮридическоеФизическоеЛицо: 'ФизическоеЛицо' };
}

@Injectable()
export class OnecXmlAccountingExporter extends AccountingExporter {
  readonly format = AccountingExportFormat.OnecXml;

  async build(data: AccountingExportData): Promise<AccountingExportArtifact> {
    const xml = renderEnterpriseData(data);
    return { body: Buffer.from(xml, 'utf8'), contentType: 'application/xml; charset=utf-8', extension: 'xml' };
  }
}

export function renderEnterpriseData(data: AccountingExportData): string {
  const org = organization(data.organization);
  const created = `${localDateOf(data.generatedAt)}T${toLocalTime(data.generatedAt, REPORTING_TIMEZONE)}:00`;
  const endOfDay = (date: string) => `${date}T23:59:59`;

  const body: Record<string, unknown> = {
    '@_xmlns': ENTERPRISE_DATA_NS,
    'Справочник.Контрагенты': data.counterparties.map((c) => ({ КлючевыеСвойства: counterparty(c) })),
    'Документ.ОтчетОРозничныхПродажах': data.retailSales.map((doc) => ({
      КлючевыеСвойства: {
        Ссылка: stableRef(`retail:${doc.date}:${doc.branch.branchId}`),
        Дата: endOfDay(doc.date),
        Номер: `${doc.branch.code || 'AULA'}-${doc.date.replace(/-/g, '')}`,
        Организация: org,
      },
      Склад: warehouse(doc.branch),
      Валюта: 'KZT',
      КоличествоЧеков: doc.orders,
      СуммаДокумента: amount(doc.total),
      СуммаСкидок: amount(doc.discounts),
      СуммаВозвратов: amount(doc.refunds),
      Товары: {
        Строка: doc.lines.map((line) => ({
          Номенклатура: { Код: line.dishId, Наименование: translate(line.name, 'ru') },
          Количество: line.quantity,
          Цена: amount(averageAmount(line.amount, line.quantity)),
          Сумма: amount(line.amount),
        })),
      },
      Услуги: doc.deliveryFees.isZero() ? undefined : { Строка: [{ Содержание: 'Доставка', Сумма: amount(doc.deliveryFees) }] },
      Оплаты: {
        Строка: doc.payments.map((p) => ({ ВидОплаты: PAYMENT_KIND[p.method], Код: p.method, Сумма: amount(p.amount) })),
      },
    })),
    'Документ.ПродажаПодарочныхСертификатов': data.certificateSales.map((doc) => ({
      КлючевыеСвойства: {
        Ссылка: stableRef(`certificates:${doc.date}:${doc.branch?.branchId ?? 'online'}`),
        Дата: endOfDay(doc.date),
        Номер: `CERT-${doc.date.replace(/-/g, '')}${doc.branch?.code ? `-${doc.branch.code}` : ''}`,
        Организация: org,
      },
      Склад: warehouse(doc.branch),
      Валюта: 'KZT',
      Количество: doc.count,
      СуммаДокумента: amount(doc.amount),
    })),
    'Документ.СчетНаОплатуПокупателю': data.invoices.map((doc) => ({
      КлючевыеСвойства: { Ссылка: doc.id, Дата: `${doc.date}T00:00:00`, Номер: doc.number, Организация: org },
      Контрагент: counterparty(doc.counterparty),
      Склад: warehouse(doc.branch),
      Валюта: 'KZT',
      СуммаДокумента: amount(doc.amount),
      Оплачено: amount(doc.paidTotal),
      СрокОплаты: doc.dueDate ?? undefined,
      Основание: `Банкетная заявка ${doc.requestId}`,
    })),
    'Документ.РеализацияТоваровУслуг': data.acts.map((doc) => ({
      КлючевыеСвойства: { Ссылка: doc.id, Дата: `${doc.date}T00:00:00`, Номер: doc.number, Организация: org },
      ВидОперации: 'РеализацияУслуг',
      Контрагент: counterparty(doc.counterparty),
      Склад: warehouse(doc.branch),
      Валюта: 'KZT',
      СуммаДокумента: amount(doc.amount),
      СуммаНДС: amount(doc.vatAmount),
      Услуги: {
        Строка: [
          {
            Содержание: `Банкетное обслуживание (акт ${doc.number})`,
            Количество: 1,
            Сумма: amount(doc.amount),
            СуммаНДС: amount(doc.vatAmount),
          },
        ],
      },
    })),
  };

  const message = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    Message: {
      '@_xmlns:msg': MESSAGE_NS,
      '@_xmlns:xs': 'http://www.w3.org/2001/XMLSchema',
      '@_xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      'msg:Header': {
        'msg:Format': ENTERPRISE_DATA_NS,
        'msg:CreationDate': created,
        'msg:Confirmation': false,
        'msg:AvailableVersion': '1.8',
        'msg:MessageNo': data.exportId,
        'msg:From': 'AULA',
        'msg:PeriodFrom': data.periodFrom,
        'msg:PeriodTo': data.periodTo,
      },
      Body: body,
    },
  };
  const builder = new XMLBuilder({ ignoreAttributes: false, format: true, suppressEmptyNode: true, processEntities: true });
  return builder.build(message) as string;
}
