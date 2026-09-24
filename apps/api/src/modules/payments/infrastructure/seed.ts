import { Config } from '../../../shared/infrastructure/config/config';
import { ModuleSeeder } from '../../../shared/infrastructure/seed/seed.types';
import { IntegrationSettings } from '../../../shared/infrastructure/settings/integration-settings';
import { Actor } from '../../../shared/kernel/actor';
import { Money } from '../../../shared/kernel/money';
import { CertificateProductInput, CreateCertificateProduct } from '../application/certificates/certificate-product.actions';
import { ROUTING_SETTINGS_KEY } from '../application/payment-gateway.registry';
import { SANDBOX_PROVIDER, SANDBOX_SETTINGS_KEY } from './adapters/sandbox/sandbox.gateway';
import { CertificateProductRepository } from './certificate-product.repository';

function amountProduct(tenge: number, sortOrder: number, color: string): CertificateProductInput {
  const label = String(tenge).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return {
    slug: `nominal-${tenge}`,
    kind: 'amount',
    name: { ru: `Сертификат на ${label} ₸`, kk: `${label} ₸ сыйлық сертификаты`, en: `Gift certificate ${label} ₸` },
    description: {
      ru: 'Можно использовать частями во всех ресторанах AULA и при заказе на сайте.',
      kk: 'AULA-ның барлық мейрамханаларында және сайтта тапсырыс бергенде бөліп пайдалануға болады.',
      en: 'Can be used in parts in all AULA restaurants and for orders on the website.',
    },
    nominal: Money.tenge(tenge),
    price: Money.tenge(tenge),
    validityMonths: 12,
    design: { color, theme: 'classic', imageUrl: null },
    isActive: true,
    sortOrder,
  };
}

/** Демо-продукты сертификатов (dev/staging). Цены и составы — гипотезы, редактируются в админке. */
const DEMO_PRODUCTS: CertificateProductInput[] = [
  amountProduct(5_000, 10, '#7a4b2a'),
  amountProduct(10_000, 20, '#8c5a2b'),
  amountProduct(20_000, 30, '#5b3a1e'),
  amountProduct(50_000, 40, '#2f2a26'),
  {
    slug: 'set-dinner-for-two',
    kind: 'set',
    name: { ru: 'Ужин на двоих', kk: 'Екі адамға арналған кешкі ас', en: 'Dinner for two' },
    description: {
      ru: 'Два горячих блюда на выбор, салат, два десерта и чайник чая.',
      kk: 'Таңдауыңызша екі ыстық тағам, салат, екі десерт және бір шәйнек шай.',
      en: 'Two main courses of your choice, a salad, two desserts and a pot of tea.',
    },
    nominal: Money.tenge(25_000),
    price: Money.tenge(25_000),
    validityMonths: 6,
    design: { color: '#9c2f2f', theme: 'festive', imageUrl: null },
    isActive: true,
    sortOrder: 50,
  },
];

/**
 * Стартовые данные Payments (идемпотентно):
 * - вне production: тестовый провайдер включён и выбран по умолчанию — только если настройки ещё не заданы
 *   (боевые настройки Kaspi/Halyk вводит администратор системы в админке);
 * - демо: продукты сертификатов (5 000, 10 000, 20 000, 50 000 ₸ и набор «Ужин на двоих»), поиск по slug.
 */
export const seedPayments: ModuleSeeder = async (ctx) => {
  const config = ctx.app.get(Config);
  const settings = ctx.app.get(IntegrationSettings);
  if (!config.isProduction) {
    if (!(await settings.getRaw(SANDBOX_SETTINGS_KEY))) {
      await settings.set(SANDBOX_SETTINGS_KEY, { enabled: true, config: { paymentTtlMinutes: 30 } }, ctx.ownerUserId);
      ctx.log('Тестовый платёжный провайдер включён');
    }
    if (!(await settings.getRaw(ROUTING_SETTINGS_KEY))) {
      await settings.set(ROUTING_SETTINGS_KEY, { enabled: true, config: { defaultProvider: SANDBOX_PROVIDER, branchOverrides: {} } }, ctx.ownerUserId);
      ctx.log('Маршрутизация платежей: провайдер по умолчанию — тестовый');
    }
  }
  if (!ctx.demo) return;
  const products = ctx.app.get(CertificateProductRepository);
  const create = ctx.app.get(CreateCertificateProduct);
  const actor = Actor.system('seed');
  let created = 0;
  for (const product of DEMO_PRODUCTS) {
    if (await products.findBySlug(product.slug)) continue;
    await create.execute(actor, product);
    created++;
  }
  if (created > 0) ctx.log(`Демо-продукты сертификатов: ${created}`);
};
