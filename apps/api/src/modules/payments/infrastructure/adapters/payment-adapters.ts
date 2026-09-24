import { IntegrationDescriptor } from '../../../../shared/infrastructure/settings/integration-catalog';
import { ROUTING_SETTINGS_KEY } from '../../application/payment-gateway.registry';
import { HALYK_DESCRIPTOR, HALYK_PROVIDER, HalykGateway } from './halyk/halyk.gateway';
import { KASPI_DESCRIPTOR, KASPI_PROVIDER, KaspiGateway } from './kaspi/kaspi.gateway';
import { SANDBOX_DESCRIPTOR, SANDBOX_PROVIDER, SandboxGateway } from './sandbox/sandbox.gateway';

/** Адаптеры платёжных провайдеров модуля (регистрируются в payments.module.ts). */
export const PAYMENT_GATEWAY_CLASSES = [SandboxGateway, HalykGateway, KaspiGateway] as const;

export const PAYMENT_PROVIDER_NAMES = [SANDBOX_PROVIDER, HALYK_PROVIDER, KASPI_PROVIDER] as const;

/** Маршрутизация: основной провайдер выбирается в настройках, можно по филиалу (decisions.md, п. 8). */
export const ROUTING_DESCRIPTOR: IntegrationDescriptor = {
  key: ROUTING_SETTINGS_KEY,
  title: 'Платежи: выбор провайдера',
  category: 'payments',
  stage: 1,
  description:
    'Провайдер онлайн-оплаты по умолчанию и переопределения по филиалам (у франчайзи может быть свой мерчант). ' +
    'Смена провайдера не затрагивает модули заказа, брони и банкетов.',
  fields: [
    { name: 'defaultProvider', label: 'Провайдер по умолчанию', type: 'select', required: true, options: [...PAYMENT_PROVIDER_NAMES] },
    {
      name: 'branchOverrides',
      label: 'Провайдер по филиалам',
      type: 'json',
      help: '{ "<id филиала>": "<провайдер>" }',
    },
  ],
};

export const PAYMENT_DESCRIPTORS: IntegrationDescriptor[] = [ROUTING_DESCRIPTOR, SANDBOX_DESCRIPTOR, HALYK_DESCRIPTOR, KASPI_DESCRIPTOR];
