import { Injectable } from '@nestjs/common';
import { Config } from '../../../shared/infrastructure/config/config';
import { IntegrationCatalog } from '../../../shared/infrastructure/settings/integration-catalog';
import { IntegrationSettings } from '../../../shared/infrastructure/settings/integration-settings';
import { Actor } from '../../../shared/kernel/actor';
import { Permission } from '../../../shared/kernel/permissions';
import { PaymentMethod } from '../public';
import { PaymentGatewayRegistry, ROUTING_SETTINGS_KEY, RoutingSettingsSchema } from './payment-gateway.registry';

export interface PaymentProviderInfo {
  provider: string;
  title: string;
  enabled: boolean;
  isDefault: boolean;
  devFallback: boolean;
  branchIds: string[];
}

export interface PaymentMethodInfo {
  method: PaymentMethod;
  title: string;
  provider: string | null;
  available: boolean;
}

export interface PaymentProvidersView {
  routingConfigured: boolean;
  defaultProvider: string | null;
  providers: PaymentProviderInfo[];
  methods: PaymentMethodInfo[];
}

const METHOD_TITLES: Record<PaymentMethod, string> = {
  online: 'Онлайн-оплата картой',
  on_receipt: 'Оплата при получении',
  gift_certificate: 'Подарочный сертификат',
  bank_transfer: 'Банковский перевод (счёт юрлицу)',
};

/**
 * Какие платёжные провайдеры подключены и какие способы оплаты доступны (фильтры и подписи в разделе
 * «Платежи»). Секреты провайдеров не раскрываются — только включён ли провайдер и куда он маршрутизирован.
 */
@Injectable()
export class PaymentProvidersQuery {
  constructor(
    private readonly registry: PaymentGatewayRegistry,
    private readonly settings: IntegrationSettings,
    private readonly catalog: IntegrationCatalog,
    private readonly config: Config,
  ) {}

  async execute(actor: Actor): Promise<PaymentProvidersView> {
    actor.assertCanSomewhere(Permission.PaymentsView);
    const routing = await this.settings.get(ROUTING_SETTINGS_KEY, RoutingSettingsSchema);
    const fallback = !routing && !this.config.isProduction ? (this.registry.providers().find((p) => this.registry.get(p).devFallback) ?? null) : null;
    const defaultProvider = routing?.defaultProvider ?? fallback;
    const visibleBranch = (branchId: string) => actor.can(Permission.PaymentsView, branchId);
    const providers: PaymentProviderInfo[] = [];
    for (const name of this.registry.providers()) {
      const gateway = this.registry.get(name);
      providers.push({
        provider: name,
        title: this.catalog.get(`payments.${name}`)?.title ?? name,
        enabled: await gateway.isEnabled(),
        isDefault: defaultProvider === name,
        devFallback: gateway.devFallback,
        branchIds: Object.entries(routing?.branchOverrides ?? {})
          .filter(([branchId, provider]) => provider === name && visibleBranch(branchId))
          .map(([branchId]) => branchId),
      });
    }
    const onlineAvailable = providers.some((p) => p.enabled && (p.isDefault || p.branchIds.length > 0));
    const methods: PaymentMethodInfo[] = (Object.keys(METHOD_TITLES) as PaymentMethod[]).map((method) => ({
      method,
      title: METHOD_TITLES[method],
      provider: method === 'online' ? defaultProvider : method,
      available: method === 'online' ? onlineAvailable : true,
    }));
    return { routingConfigured: !!routing, defaultProvider, providers, methods };
  }
}
