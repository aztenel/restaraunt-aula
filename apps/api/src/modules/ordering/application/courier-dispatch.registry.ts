import { Inject, Injectable } from '@nestjs/common';
import { z, ZodType } from 'zod';
import { IntegrationDescriptor } from '../../../shared/infrastructure/settings/integration-catalog';
import { IntegrationSettings } from '../../../shared/infrastructure/settings/integration-settings';
import { ValidationError } from '../../../shared/kernel/errors';
import { CourierDispatch, OWN_COURIER_PROVIDER } from '../domain/courier-dispatch';

/** Токен списка служб курьеров (собирается в ordering.module.ts). */
export const COURIER_DISPATCHERS = Symbol('COURIER_DISPATCHERS');

/** Ключ настройки: какая служба курьеров обслуживает филиал. */
export const COURIER_ROUTING_SETTINGS_KEY = 'ordering.courier_routing';

const providerName = z.string().regex(/^[a-z0-9_]+$/, 'provider must be lowercase latin, digits, _');

export const CourierRoutingSchema = z.object({
  default: providerName.default(OWN_COURIER_PROVIDER),
  /** { '<branchId>': '<provider>' } */
  branches: z.record(providerName).default({}),
});
export type CourierRouting = z.infer<typeof CourierRoutingSchema>;

export function courierRoutingDescriptor(providers: string[]): IntegrationDescriptor {
  return {
    key: COURIER_ROUTING_SETTINGS_KEY,
    title: 'Доставка: курьеры по филиалам',
    category: 'delivery',
    stage: 3,
    description:
      'Кто доставляет заказы филиала. own — свои курьеры (по умолчанию): заказ ведёт оператор. ' +
      'Внешняя служба: при переходе заказа доставки в «Готов» создаётся заявка на курьера, статус опрашивается задачей.',
    fields: [
      { name: 'default', label: 'Служба по умолчанию', type: 'select', options: providers, required: true },
      { name: 'branches', label: 'Служба по филиалам', type: 'json', help: '{ "<id филиала>": "<служба>" } — переопределение для точек' },
    ],
  };
}

/**
 * Реестр служб курьеров и выбор службы филиала по настройке ordering.courier_routing.
 * Имена конкретных провайдеров здесь не встречаются: адаптеры регистрируются в модуле.
 */
@Injectable()
export class CourierDispatchRegistry {
  private readonly byName: Map<string, CourierDispatch>;

  constructor(
    @Inject(COURIER_DISPATCHERS) dispatchers: CourierDispatch[],
    private readonly settings: IntegrationSettings,
  ) {
    this.byName = new Map(dispatchers.map((d) => [d.provider, d]));
  }

  providers(): string[] {
    return [...this.byName.keys()];
  }

  async routing(): Promise<CourierRouting> {
    const routing = await this.settings.get(COURIER_ROUTING_SETTINGS_KEY, CourierRoutingSchema as unknown as ZodType<CourierRouting>);
    return routing ?? { default: OWN_COURIER_PROVIDER, branches: {} };
  }

  async providerFor(branchId: string): Promise<string> {
    const routing = await this.routing();
    return routing.branches[branchId] ?? routing.default ?? OWN_COURIER_PROVIDER;
  }

  get(provider: string): CourierDispatch {
    const dispatcher = this.byName.get(provider);
    if (!dispatcher) {
      throw new ValidationError('courier.unknown_provider', 'Unknown courier provider', { provider, known: this.providers() });
    }
    return dispatcher;
  }

  async resolve(branchId: string): Promise<CourierDispatch> {
    return this.get(await this.providerFor(branchId));
  }
}
