import { Inject, Injectable } from '@nestjs/common';
import { EsfGateway } from '../domain/esf';

/** Токен списка адаптеров ЭСФ (порядок = приоритет, последний — режим по умолчанию; собирается в banquet.module.ts). */
export const ESF_GATEWAYS = Symbol('ESF_GATEWAYS');

/**
 * Выбор адаптера ЭСФ: первый включённый в настройках по приоритету, иначе режим по умолчанию
 * (черновик XML для бухгалтера). Имена провайдеров здесь не встречаются.
 */
@Injectable()
export class EsfGatewayRegistry {
  constructor(@Inject(ESF_GATEWAYS) private readonly gateways: EsfGateway[]) {}

  providers(): string[] {
    return this.gateways.map((g) => g.provider);
  }

  get(provider: string | null): EsfGateway | null {
    return this.gateways.find((g) => g.provider === provider) ?? null;
  }

  async resolve(): Promise<EsfGateway> {
    for (const gateway of this.gateways) {
      if (await gateway.isEnabled()) return gateway;
    }
    return this.gateways[this.gateways.length - 1]!;
  }
}
