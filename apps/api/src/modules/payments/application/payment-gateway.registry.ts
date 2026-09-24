import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Config } from '../../../shared/infrastructure/config/config';
import { IntegrationSettings } from '../../../shared/infrastructure/settings/integration-settings';
import { NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { GatewayPayment, PaymentGateway } from '../domain/payment-gateway';
import { Payment } from '../domain/payment';

/** Токен списка адаптеров провайдеров (собирается в payments.module.ts). */
export const PAYMENT_GATEWAYS = Symbol('PAYMENT_GATEWAYS');

/** Ключ настроек маршрутизации платежей: провайдер по умолчанию и переопределения по филиалам. */
export const ROUTING_SETTINGS_KEY = 'payments.routing';

export const RoutingSettingsSchema = z.object({
  defaultProvider: z.string().min(1),
  /** { '<branchId>': '<provider>' } — у франчайзи может быть свой мерчант. */
  branchOverrides: z.record(z.string()).default({}),
});
export type RoutingSettings = z.infer<typeof RoutingSettingsSchema>;

/**
 * Реестр адаптеров платёжных провайдеров и выбор провайдера для нового онлайн-платежа.
 * Имена провайдеров здесь не встречаются: адаптеры регистрируются в модуле, выбор — по настройке.
 */
@Injectable()
export class PaymentGatewayRegistry {
  private readonly byName: Map<string, PaymentGateway>;

  constructor(
    @Inject(PAYMENT_GATEWAYS) gateways: PaymentGateway[],
    private readonly settings: IntegrationSettings,
    private readonly config: Config,
  ) {
    this.byName = new Map(gateways.map((g) => [g.provider, g]));
  }

  providers(): string[] {
    return [...this.byName.keys()];
  }

  find(provider: string): PaymentGateway | null {
    return this.byName.get(provider) ?? null;
  }

  /** Адаптер провайдера существующего платежа (возвраты, опрос, вебхуки). */
  get(provider: string): PaymentGateway {
    const gateway = this.find(provider);
    if (!gateway) throw new NotFoundError('payment_provider', provider);
    return gateway;
  }

  /**
   * Провайдер для нового онлайн-платежа: переопределение филиала -> провайдер по умолчанию ->
   * (вне production, если маршрутизация не настроена) тестовый провайдер. Провайдер должен быть включён.
   */
  async resolveForNewPayment(branchId: string | null): Promise<PaymentGateway> {
    const routing = await this.settings.get(ROUTING_SETTINGS_KEY, RoutingSettingsSchema);
    let name: string | null = null;
    if (routing) {
      name = (branchId ? (routing.branchOverrides ?? {})[branchId] : undefined) ?? routing.defaultProvider;
    } else if (!this.config.isProduction) {
      name = [...this.byName.values()].find((g) => g.devFallback)?.provider ?? null;
    }
    const gateway = name ? this.find(name) : null;
    if (!gateway || !(await gateway.isEnabled())) {
      throw new ValidationError('payment.provider_unavailable', 'Online payment provider is not configured', {
        provider: name,
        branchId,
      });
    }
    return gateway;
  }
}

/** Данные платежа для адаптера провайдера. */
export function toGatewayPayment(payment: Payment): GatewayPayment {
  const s = payment.snapshot();
  return {
    paymentId: s.id,
    invoiceNo: s.invoiceNo,
    externalId: s.externalId,
    purpose: s.purpose,
    branchId: s.branchId,
    amount: s.amount,
    description: s.description,
    customer: { ...s.customer },
    returnUrl: s.returnUrl,
    providerData: { ...s.providerData },
  };
}
