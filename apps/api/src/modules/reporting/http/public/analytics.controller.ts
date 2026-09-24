import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../../shared/infrastructure/http/decorators';
import { RateLimit } from '../../../../shared/infrastructure/rate-limit/rate-limit.guard';
import { RecordStorefrontEvent } from '../../application/storefront.actions';
import { StorefrontEventDto } from '../dto';

/**
 * Аналитика витрины для отчёта «Конверсия витрины в заказ». Без персональных данных:
 * анонимный id сессии, тип события, путь без параметров. Ограничение частоты — 'tracking'.
 */
@ApiTags('public')
@Public()
@Controller('public/analytics')
export class PublicAnalyticsController {
  constructor(private readonly record: RecordStorefrontEvent) {}

  @RateLimit('tracking')
  @Post('events')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Событие принято' })
  async event(@Body() dto: StorefrontEventDto): Promise<void> {
    await this.record.execute(dto);
  }
}
