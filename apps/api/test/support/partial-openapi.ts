import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureHttpApp } from '../../src/main';
import { CatalogModule } from '../../src/modules/catalog/catalog.module';
import { CustomersModule } from '../../src/modules/customers/customers.module';
import { IdentityModule } from '../../src/modules/identity/identity.module';
import { NotificationsModule } from '../../src/modules/notifications/notifications.module';
import { OrderQuery } from '../../src/modules/ordering/public';
import { PaymentsModule } from '../../src/modules/payments/payments.module';
import { PosModule } from '../../src/modules/pos/pos.module';
import { ReportingModule } from '../../src/modules/reporting/reporting.module';
import { VenueAvailability } from '../../src/modules/reservation/public';
import { Config } from '../../src/shared/infrastructure/config/config';
import { buildOpenApiDocument } from '../../src/shared/infrastructure/http/swagger';
import { PlatformModule } from '../../src/shared/infrastructure/platform.module';
import { createFakes } from '../fakes';

/**
 * Промежуточная генерация OpenAPI, пока часть модулей в разработке: готовые модули подключаются
 * по-настоящему, контракты недостающих — заглушками. Итоговый документ строит src/cli/openapi.ts.
 */
async function main(): Promise<void> {
  process.env.QUEUE_DRIVER = 'inline';
  process.env.QUEUE_INLINE_AUTODRAIN = 'false';
  const config = new Config();
  const fakes = createFakes();

  @Global()
  @Module({
    providers: [
      { provide: OrderQuery, useValue: fakes.orders },
      { provide: VenueAvailability, useValue: fakes.venues },
    ],
    exports: [OrderQuery, VenueAvailability],
  })
  class MissingContractsModule {}

  @Module({
    imports: [
      PlatformModule.forRoot(config),
      MissingContractsModule,
      IdentityModule,
      NotificationsModule,
      CustomersModule,
      CatalogModule,
      PaymentsModule,
      ReportingModule,
      PosModule,
    ],
  })
  class PartialAppModule {}

  const app = await NestFactory.create<NestExpressApplication>(PartialAppModule, { logger: false, rawBody: true });
  configureHttpApp(app, config);
  const document = buildOpenApiDocument(app, 'partial');
  const target = resolve(__dirname, '..', '..', '..', '..', 'docs', 'openapi.json');
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`Partial OpenAPI written: ${Object.keys(document.paths).length} paths`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
