import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const started = process.hrtime.bigint();
    const req = context.switchToHttp().getRequest<Request>();
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    const done = () => {
      const res = context.switchToHttp().getResponse<Response>();
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      this.metrics.httpDuration.observe({ method: req.method, route, status: String(res.statusCode) }, seconds);
      if (res.statusCode >= 500) this.metrics.httpErrors.inc({ route });
    };
    return next.handle().pipe(tap({ next: done, error: done }));
  }
}
