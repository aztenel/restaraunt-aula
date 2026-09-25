import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../app.module';
import { configureHttpApp } from '../main';
import { Config } from '../shared/infrastructure/config/config';
import { buildOpenApiDocument } from '../shared/infrastructure/http/swagger';

/** Генерация описания OpenAPI в docs/openapi.json (по нему строятся клиенты админки, витрины, мобильного приложения). */
async function main(): Promise<void> {
  process.env.QUEUE_DRIVER ??= 'inline';
  process.env.QUEUE_INLINE_AUTODRAIN = 'false';
  process.env.LOG_LEVEL = 'silent';
  const config = new Config();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), { logger: false, rawBody: true });
  configureHttpApp(app, config);
  const document = buildOpenApiDocument(app, process.env.RELEASE ?? '1.0.0');
  const target = resolve(__dirname, '..', '..', '..', '..', 'docs', 'openapi.json');
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`OpenAPI written to ${target}: ${Object.keys(document.paths).length} paths`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
