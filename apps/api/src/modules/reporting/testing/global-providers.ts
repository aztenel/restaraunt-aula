import { DynamicModule, Global, Module, Provider } from '@nestjs/common';

@Global()
@Module({})
class ReportingTestContractsModule {}

/**
 * Заглушки публичных контрактов других модулей как глобальный модуль: провайдеры корневого
 * тестового модуля (createTestApp({ providers })) не видны импортированным модулям Nest.
 */
export function globalProviders(providers: Provider[]): DynamicModule {
  return {
    module: ReportingTestContractsModule,
    global: true,
    providers,
    exports: providers.map((p) => (typeof p === 'function' ? p : p.provide)),
  };
}
