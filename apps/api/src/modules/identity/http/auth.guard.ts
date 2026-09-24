import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RequestContext } from '../../../shared/infrastructure/context/request-context';
import {
  ALLOW_PENDING_PASSWORD_KEY,
  IS_PUBLIC_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from '../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../shared/kernel/actor';
import { ForbiddenError, UnauthenticatedError } from '../../../shared/kernel/errors';
import { Permission } from '../../../shared/kernel/permissions';
import { ActorResolver } from '../application/actor-resolver';
import { TokenService } from '../application/token.service';

/**
 * Глобальный guard: по умолчанию всё закрыто. Публичные маршруты помечены @Public().
 * Сотрудник определяется по Bearer JWT, права загружаются из ролей (с кэшем 30 с).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly actors: ActorResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ?? false;
    const req = context.switchToHttp().getRequest<Request & { actor?: Actor }>();

    let actor: Actor | null = null;
    let mustChangePassword = false;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const payload = this.tokens.verifyAccess(header.slice(7));
      if (payload) {
        const resolved = await this.actors.resolveWithFlags(payload.sub);
        actor = resolved.actor;
        mustChangePassword = resolved.mustChangePassword;
      }
    }
    if (actor) {
      req.actor = actor;
      RequestContext.setActor(actor);
    }
    if (isPublic) return true;
    if (!actor) throw new UnauthenticatedError();

    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_KEY, targets) ?? false;
    if (mustChangePassword && !allowPending) {
      throw new ForbiddenError('auth.password_change_required', 'Change the temporary password first');
    }
    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS_KEY, targets) ?? [];
    if (required.length > 0 && !required.some((p) => actor.canSomewhere(p))) {
      throw new ForbiddenError('access.forbidden', 'Not enough permissions', { required });
    }
    return true;
  }
}
