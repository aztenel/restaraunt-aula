import { z } from 'zod';
import { IntegrationDescriptor } from '../../../../../shared/infrastructure/settings/integration-catalog';
import { ESF_XML_FIELDS, EsfXmlOptionsSchema } from '../esf-xml';

/** ИС ЭСФ (esf.gov.kz): отправка счетов-фактур через SOAP API с подписью ЭЦП через NCANode. */
export const ISESF_PROVIDER = 'isesf';
export const ISESF_SETTINGS_KEY = 'banquet.esf_isesf';
export const ISESF_DEFAULT_BASE_URL = 'https://esf.gov.kz:8443/esf-web/ws/api1';

const path = z
  .string()
  .trim()
  .regex(/^\/[A-Za-z0-9/_.-]*$/, 'must start with /');
const stripSlash = (u: string) => u.replace(/\/+$/, '');

export const IsEsfSettingsSchema = EsfXmlOptionsSchema.extend({
  baseUrl: z.string().url().default(ISESF_DEFAULT_BASE_URL).transform(stripSlash),
  sessionPath: path.default('/SessionService'),
  uploadPath: path.default('/UploadInvoiceService'),
  invoicePath: path.default('/InvoiceService'),
  /** ИИН пользователя ИС ЭСФ. */
  username: z.string().trim().min(1),
  password: z.string().min(1),
  /** БИН налогоплательщика (продавца). */
  tin: z.string().regex(/^\d{12}$/),
  /** Сертификат аутентификации (X.509, base64) — для создания сессии. */
  authCertificate: z.string().trim().min(1),
  /** Сертификат подписи (X.509, base64) — передаётся с подписанным ЭСФ. */
  signCertificate: z.string().trim().min(1),
  /** NCANode (сервис подписи ЭЦП): адрес и метод подписи. */
  ncanodeUrl: z.string().url().transform(stripSlash),
  ncanodeSignPath: path.default('/cms/sign'),
  /** Ключ ЭЦП для подписи (PKCS#12, base64) и пароль. */
  signKey: z.string().trim().min(1),
  signKeyPassword: z.string().min(1),
  timeoutMs: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
});
export type IsEsfSettings = z.infer<typeof IsEsfSettingsSchema>;

export const ISESF_INTEGRATION: IntegrationDescriptor = {
  key: ISESF_SETTINGS_KEY,
  title: 'ЭСФ: отправка через API ИС ЭСФ',
  category: 'esf',
  stage: 3,
  description:
    'ЭСФ по акту для юрлица отправляется в ИС ЭСФ автоматически (фоновая задача с повторами): подпись ЭЦП через NCANode, ' +
    'сессия и загрузка через SOAP API, затем проверка регистрационного номера. Если выключено — формируется черновик XML для бухгалтера.',
  fields: [
    { name: 'baseUrl', label: 'Адрес API ИС ЭСФ', type: 'url', help: `По умолчанию ${ISESF_DEFAULT_BASE_URL}` },
    { name: 'sessionPath', label: 'Путь сервиса сессий', type: 'string', help: 'По умолчанию /SessionService' },
    { name: 'uploadPath', label: 'Путь сервиса загрузки ЭСФ', type: 'string', help: 'По умолчанию /UploadInvoiceService' },
    { name: 'invoicePath', label: 'Путь сервиса запросов ЭСФ', type: 'string', help: 'По умолчанию /InvoiceService' },
    { name: 'username', label: 'ИИН пользователя ИС ЭСФ', type: 'string', required: true },
    { name: 'password', label: 'Пароль пользователя ИС ЭСФ', type: 'string', secret: true, required: true },
    { name: 'tin', label: 'БИН налогоплательщика', type: 'string', required: true },
    { name: 'authCertificate', label: 'Сертификат аутентификации (base64)', type: 'string', secret: true, required: true },
    { name: 'signCertificate', label: 'Сертификат подписи (base64)', type: 'string', secret: true, required: true },
    { name: 'ncanodeUrl', label: 'Адрес NCANode', type: 'url', required: true, help: 'Например http://ncanode:14579' },
    { name: 'ncanodeSignPath', label: 'Метод подписи NCANode', type: 'string', help: 'По умолчанию /cms/sign' },
    { name: 'signKey', label: 'Ключ ЭЦП (PKCS#12, base64)', type: 'string', secret: true, required: true },
    { name: 'signKeyPassword', label: 'Пароль ключа ЭЦП', type: 'string', secret: true, required: true },
    { name: 'timeoutMs', label: 'Таймаут запроса, мс', type: 'number', help: 'По умолчанию 30000' },
    ...ESF_XML_FIELDS,
  ],
};
