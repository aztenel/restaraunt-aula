import { Inject, Injectable } from '@nestjs/common';
import { z, ZodType } from 'zod';
import { IntegrationDescriptor } from '../../../shared/infrastructure/settings/integration-catalog';
import { IntegrationSettings } from '../../../shared/infrastructure/settings/integration-settings';
import { ValidationError } from '../../../shared/kernel/errors';
import { PosClient } from '../domain/pos-client';
import { DEFAULT_POS_PROVIDER, PosRouting, providerForBranch } from '../domain/routing';

/** Токен списка адаптеров POS (собирается в pos.module.ts). */
export const POS_CLIENTS = Symbol('POS_CLIENTS');

/** Код ошибки: в настройке или запросе указан провайдер, для которого нет адаптера. */
export const UNKNOWN_PROVIDER = 'pos.unknown_provider';

/** Ключ настройки маршрутизации филиалов по POS. */
export const POS_ROUTING_SETTINGS_KEY = 'pos.routing';

const providerName = z.string().regex(/^[a-z0-9_]+$/, 'provider must be lowercase latin, digits, _');

export const PosRoutingSchema = z.object({
  default: providerName.default(DEFAULT_POS_PROVIDER),
  /** { '<branchId>': '<provider>' } */
  branches: z.record(providerName).default({}),
});

/** Описание настройки маршрутизации для админки (варианты — зарегистрированные адаптеры). */
export function posRoutingDescriptor(providers: string[]): IntegrationDescriptor {
  return {
    key: POS_ROUTING_SETTINGS_KEY,
    title: 'POS: маршрутизация филиалов',
    category: 'pos',
    stage: 3,
    description:
      'Какая кассовая система стоит на точке. manual — внешней системы нет, кухня работает по экрану заказов админки (по умолчанию).',
    fields: [
      { name: 'default', label: 'POS по умолчанию', type: 'select', options: providers, required: true },
      {
        name: 'branches',
        label: 'POS по филиалам',
        type: 'json',
        help: '{ "<id филиала>": "<провайдер>" } — переопределение для отдельных точек',
      },
    ],
  };
}

export interface ResolvedPosClient {
  provider: string;
  client: PosClient;
}

/**
 * Реестр адаптеров POS и выбор POS для филиала по настройке pos.routing.
 * Имена конкретных провайдеров здесь не встречаются: адаптеры регистрируются в модуле.
 */
@Injectable()
export class PosClientRegistry {
  private readonly byName: Map<string, PosClient>;

  constructor(
    @Inject(POS_CLIENTS) clients: PosClient[],
    private readonly settings: IntegrationSettings,
  ) {
    this.byName = new Map(clients.map((c) => [c.provider, c]));
  }

  providers(): string[] {
    return [...this.byName.keys()];
  }

  find(provider: string): PosClient | null {
    return this.byName.get(provider) ?? null;
  }

  async routing(): Promise<PosRouting> {
    // Схема с значениями по умолчанию: вход и выход различаются, get() типизирован по выходу.
    const routing = await this.settings.get(POS_ROUTING_SETTINGS_KEY, PosRoutingSchema as unknown as ZodType<PosRouting>);
    return routing ?? { default: DEFAULT_POS_PROVIDER, branches: {} };
  }

  /** Провайдер филиала по настройке (без проверки, что адаптер существует). */
  async providerFor(branchId: string): Promise<string> {
    return providerForBranch(await this.routing(), branchId);
  }

  /** Адаптер POS филиала. Неизвестный провайдер в настройке — ValidationError pos.unknown_provider. */
  async resolve(branchId: string): Promise<ResolvedPosClient> {
    const provider = await this.providerFor(branchId);
    return { provider, client: this.get(provider) };
  }

  get(provider: string): PosClient {
    const client = this.find(provider);
    if (!client) throw new ValidationError(UNKNOWN_PROVIDER, 'Unknown POS provider', { provider, known: this.providers() });
    return client;
  }
}
