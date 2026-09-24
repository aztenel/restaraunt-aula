import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { Response } from 'express';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  InvalidStateTransitionError,
  InvariantViolationError,
  NotFoundError,
  TooManyRequestsError,
  UnauthenticatedError,
  ValidationError,
} from '../../kernel/errors';
import { RequestContext } from '../context/request-context';

export interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
  requestId: string | null;
}

function statusOf(err: DomainError): number {
  if (err instanceof NotFoundError) return HttpStatus.NOT_FOUND;
  if (err instanceof UnauthenticatedError) return HttpStatus.UNAUTHORIZED;
  if (err instanceof ForbiddenError) return HttpStatus.FORBIDDEN;
  if (err instanceof ConflictError || err instanceof InvalidStateTransitionError) return HttpStatus.CONFLICT;
  if (err instanceof TooManyRequestsError) return HttpStatus.TOO_MANY_REQUESTS;
  if (err instanceof InvariantViolationError) return HttpStatus.INTERNAL_SERVER_ERROR;
  if (err instanceof ValidationError) return HttpStatus.UNPROCESSABLE_ENTITY;
  return HttpStatus.UNPROCESSABLE_ENTITY;
}

/** Единый формат ошибок API: { error: { code, message, details }, requestId }. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = RequestContext.requestId();
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorBody;

    if (exception instanceof DomainError) {
      status = statusOf(exception);
      body = { error: { code: exception.code, message: exception.message, details: exception.details }, requestId };
      if (exception instanceof TooManyRequestsError && exception.details?.retryAfterSeconds) {
        res.setHeader('retry-after', String(exception.details.retryAfterSeconds));
      }
      if (status >= 500) {
        this.logger.error({ err: exception }, 'Invariant violation');
        Sentry.captureException(exception);
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string' ? response : ((response as { message?: string | string[] }).message ?? exception.message);
      body = {
        error: {
          code: status === 400 ? 'request.invalid' : `http.${status}`,
          message: Array.isArray(message) ? message.join('; ') : String(message),
          details: Array.isArray(message) ? { fields: message } : undefined,
        },
        requestId,
      };
    } else {
      this.logger.error({ err: exception }, 'Unhandled error');
      Sentry.captureException(exception);
      body = { error: { code: 'internal', message: 'Internal server error' }, requestId };
    }
    res.status(status).json(body);
  }
}
