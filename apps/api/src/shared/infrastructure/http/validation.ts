import { ValidationPipe } from '@nestjs/common';

/** Контроллер только валидирует вход: DTO class-validator, лишние поля запрещены. */
export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    stopAtFirstError: false,
  });
}
