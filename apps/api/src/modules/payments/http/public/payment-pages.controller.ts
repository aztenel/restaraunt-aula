import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiProduces, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../../../shared/infrastructure/http/decorators';
import { RateLimit } from '../../../../shared/infrastructure/rate-limit/rate-limit.guard';
import { RenderCheckoutPage } from '../../application/render-checkout-page.action';
import { SandboxCheckoutPage, SimulateSandboxPayment } from '../../infrastructure/adapters/sandbox/sandbox-simulator';
import { SandboxActionDto } from '../payments.dto';

function sendHtml(res: Response, html: string): void {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.send(html);
}

/**
 * Страницы оплаты на нашем домене: песочница (dev/staging; в production — 404) и страница
 * с виджетом провайдера. Данные карты вводятся только на стороне провайдера.
 */
@ApiTags('public')
@Public()
@Controller('public/payments')
export class PaymentPagesController {
  constructor(
    private readonly sandboxPage: SandboxCheckoutPage,
    private readonly simulate: SimulateSandboxPayment,
    private readonly checkout: RenderCheckoutPage,
  ) {}

  /** Тестовая страница оплаты: кнопки «Оплатить» / «Отказ». */
  @Get('sandbox/:paymentId')
  @ApiQuery({ name: 'sig', required: true })
  @ApiProduces('text/html')
  @ApiOkResponse({ description: 'HTML-страница тестовой оплаты', schema: { type: 'string' } })
  async sandbox(@Param('paymentId', ParseUUIDPipe) paymentId: string, @Query('sig') sig: string | undefined, @Res() res: Response): Promise<void> {
    sendHtml(res, await this.sandboxPage.execute(paymentId, sig));
  }

  /** Решение гостя на тестовой странице -> вебхук через общий конвейер -> возврат гостя на витрину. */
  @RateLimit('forms')
  @Post('sandbox/:paymentId')
  @ApiResponse({ status: 303, description: 'Перенаправление на страницу возврата (returnUrl)' })
  async sandboxAction(@Param('paymentId', ParseUUIDPipe) paymentId: string, @Body() dto: SandboxActionDto, @Res() res: Response): Promise<void> {
    const { redirectUrl } = await this.simulate.execute(paymentId, dto.sig, dto.result);
    res.redirect(303, redirectUrl);
  }

  /** Страница оплаты с виджетом провайдера (paymentUrl для провайдеров без собственной страницы). */
  @Get(':paymentId/checkout')
  @ApiQuery({ name: 'sig', required: true })
  @ApiProduces('text/html')
  @ApiOkResponse({ description: 'HTML-страница с платёжным виджетом провайдера', schema: { type: 'string' } })
  async checkoutPage(@Param('paymentId', ParseUUIDPipe) paymentId: string, @Query('sig') sig: string | undefined, @Res() res: Response): Promise<void> {
    sendHtml(res, await this.checkout.execute(paymentId, sig));
  }
}
