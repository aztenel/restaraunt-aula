import { Injectable } from '@nestjs/common';
import { IntegrationDescriptor } from '../../../../../shared/infrastructure/settings/integration-catalog';
import { IntegrationSettings } from '../../../../../shared/infrastructure/settings/integration-settings';
import { EsfGateway, EsfInvoiceData, EsfSubmitResult } from '../../../domain/esf';
import { buildEsfXml, ESF_XML_FIELDS, EsfXmlOptions, EsfXmlOptionsSchema } from '../esf-xml';

export const MANUAL_ESF_PROVIDER = 'manual';
export const MANUAL_ESF_SETTINGS_KEY = 'banquet.esf_manual';

export const MANUAL_ESF_INTEGRATION: IntegrationDescriptor = {
  key: MANUAL_ESF_SETTINGS_KEY,
  title: 'ЭСФ: черновик XML для бухгалтера (по умолчанию)',
  category: 'esf',
  stage: 3,
  description:
    'По акту выполненных работ для юрлица (если продавец — плательщик НДС) формируется XML счёта-фактуры по структуре ИС ЭСФ v2. ' +
    'Файл появляется в документах заявки; бухгалтер загружает его в ИС ЭСФ и подписывает ЭЦП. Режим действует, пока не включена отправка через API.',
  fields: ESF_XML_FIELDS,
};

/**
 * Режим «вручную» (по умолчанию): внешних вызовов нет, результат — черновик XML ЭСФ,
 * который сохраняется как документ заявки для бухгалтера.
 */
@Injectable()
export class ManualEsfGateway extends EsfGateway {
  readonly provider = MANUAL_ESF_PROVIDER;

  constructor(private readonly settings: IntegrationSettings) {
    super();
  }

  async isEnabled(): Promise<boolean> {
    return true;
  }

  private async options(): Promise<EsfXmlOptions> {
    const raw = await this.settings.getRaw(MANUAL_ESF_SETTINGS_KEY);
    const parsed = EsfXmlOptionsSchema.safeParse(raw?.config ?? {});
    return parsed.success ? parsed.data : EsfXmlOptionsSchema.parse({});
  }

  async submit(invoice: EsfInvoiceData): Promise<EsfSubmitResult> {
    return { outcome: 'draft', xml: buildEsfXml(invoice, await this.options()) };
  }
}
