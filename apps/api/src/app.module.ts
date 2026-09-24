import { DynamicModule, Module } from '@nestjs/common';
import { Config } from './shared/infrastructure/config/config';
import { loggerModule } from './shared/infrastructure/logging/logger';
import { PlatformModule } from './shared/infrastructure/platform.module';
import { DOMAIN_MODULES } from './modules';

/**
 * Модульный монолит: платформа + доменные модули. Модули общаются через публичные
 * сервисы (modules/<m>/public) и события, а не через таблицы друг друга.
 */
@Module({})
export class AppModule {
  static forRoot(config: Config = new Config()): DynamicModule {
    return {
      module: AppModule,
      imports: [loggerModule(config), PlatformModule.forRoot(config), ...DOMAIN_MODULES],
    };
  }
}
