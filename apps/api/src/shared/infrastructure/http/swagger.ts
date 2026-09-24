import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export function buildOpenApiDocument(app: INestApplication, release: string): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('AULA API')
    .setDescription(
      'Единый REST API AULA: витрина, заказ, бронь, банкеты, сертификаты, админка. ' +
        'Деньги — целые числа в тиынах с валютой. Время — ISO 8601 в UTC, отображение в Asia/Almaty.',
    )
    .setVersion(release)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'staff')
    .addTag('public', 'Публичная витрина (гость)')
    .addTag('admin', 'Админ-панель (сотрудники)')
    .addTag('webhooks', 'Входящие вебхуки провайдеров')
    .build();
  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey: string, methodKey: string) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });
}

export function setupSwagger(app: INestApplication, release: string): void {
  const document = buildOpenApiDocument(app, release);
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs/openapi.json' });
}
