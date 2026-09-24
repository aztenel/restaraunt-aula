import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Actor } from '../../kernel/actor';
import { Permission } from '../../kernel/permissions';
import { Locale, parseLocale } from '../../kernel/translatable';

export const IS_PUBLIC_KEY = 'aula:is_public';
export const REQUIRED_PERMISSIONS_KEY = 'aula:required_permissions';
export const ALLOW_PENDING_PASSWORD_KEY = 'aula:allow_pending_password';

/**
 * Доступ без авторизации (публичная витрина, вебхуки провайдеров).
 * По умолчанию всё закрыто: маршрут без @Public() требует вход сотрудника.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Маршрут доступен сотруднику, у которого есть ХОТЯ БЫ ОДНО из прав хотя бы в одном филиале.
 * Проверка по конкретному филиалу — в действии приложения: actor.assertCan(permission, branchId).
 */
export const RequirePermissions = (...permissions: Permission[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/** Маршрут доступен сотруднику, которому ещё нужно сменить временный пароль (вход, смена пароля, профиль). */
export const AllowPendingPasswordChange = (): MethodDecorator & ClassDecorator => SetMetadata(ALLOW_PENDING_PASSWORD_KEY, true);

/** Текущий актор (сотрудник). В публичных маршрутах — Actor.guest(). */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<{ actor?: Actor }>();
  return req.actor ?? Actor.guest();
});

/** Язык ответа: ?locale=kk | заголовок X-Locale | Accept-Language. По умолчанию ru. */
export const RequestLocale = createParamDecorator((_data: unknown, ctx: ExecutionContext): Locale => {
  const req = ctx.switchToHttp().getRequest<{ query?: Record<string, unknown>; headers: Record<string, string | undefined> }>();
  const fromQuery = req.query?.locale;
  if (typeof fromQuery === 'string') return parseLocale(fromQuery);
  const header = req.headers['x-locale'] ?? req.headers['accept-language']?.slice(0, 2);
  return parseLocale(header);
});

/** IP клиента (с учётом trust proxy). */
export const ClientIp = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | null => {
  const req = ctx.switchToHttp().getRequest<{ ip?: string }>();
  return req.ip ?? null;
});
