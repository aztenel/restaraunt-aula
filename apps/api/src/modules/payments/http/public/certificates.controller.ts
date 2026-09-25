import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClientIp, Public, RequestLocale } from '../../../../shared/infrastructure/http/decorators';
import { RateLimit } from '../../../../shared/infrastructure/rate-limit/rate-limit.guard';
import { Locale, LOCALES } from '../../../../shared/kernel/translatable';
import { RetryCertificateOrderPayment } from '../../application/certificates/certificate-order.actions';
import { CertificateQueries } from '../../application/certificates/certificate.queries';
import { PurchaseCertificate } from '../../application/certificates/purchase-certificate.action';
import { GiftCertificates } from '../../public';
import {
  CertificateBalanceDto,
  CertificateOrderStatusDto,
  CheckCertificateDto,
  PublicCertificateProductDto,
  PurchaseCertificateDto,
  PurchaseResultDto,
} from '../certificates.dto';

/** Подарочные сертификаты на витрине: каталог, покупка, статус заказа, проверка кода. */
@ApiTags('public')
@Public()
@Controller('public/certificates')
export class PublicCertificatesController {
  constructor(
    private readonly queries: CertificateQueries,
    private readonly purchase: PurchaseCertificate,
    private readonly giftCertificates: GiftCertificates,
    private readonly retryPayment: RetryCertificateOrderPayment,
  ) {}

  @Get('products')
  @ApiQuery({ name: 'locale', required: false, enum: LOCALES })
  @ApiOkResponse({ type: [PublicCertificateProductDto] })
  async products(@RequestLocale() locale: Locale): Promise<PublicCertificateProductDto[]> {
    return (await this.queries.activeProducts()).map((p) => PublicCertificateProductDto.from(p, locale));
  }

  /** Покупка: заказ + онлайн-платёж. Ссылка на оплату появляется асинхронно — витрина опрашивает статус заказа. */
  @RateLimit('forms')
  @Post('purchase')
  @ApiCreatedResponse({ type: PurchaseResultDto })
  async buy(@Body() dto: PurchaseCertificateDto, @ClientIp() ip: string | null): Promise<PurchaseResultDto> {
    const { order, payment } = await this.purchase.execute(
      {
        productId: dto.productId,
        quantity: dto.quantity,
        buyer: dto.buyer,
        recipient: dto.recipient,
        message: dto.message ?? null,
        deliveryChannel: dto.deliveryChannel,
        consent: dto.consent,
        locale: dto.locale,
        idempotencyKey: dto.idempotencyKey,
      },
      { ip },
    );
    return PurchaseResultDto.from(order, payment);
  }

  @RateLimit('tracking')
  @Get('orders/:token')
  @ApiQuery({ name: 'locale', required: false, enum: LOCALES })
  @ApiOkResponse({ type: CertificateOrderStatusDto })
  async order(@Param('token') token: string, @RequestLocale() locale: Locale): Promise<CertificateOrderStatusDto> {
    return CertificateOrderStatusDto.from(await this.queries.orderStatus(token), locale);
  }

  /**
   * Повторить оплату заказа сертификатов (прошлая попытка отклонена или отменена по сроку). Пока текущий
   * платёж ждёт оплату — возвращается он же. Ссылка на оплату появляется асинхронно (опрашивайте статус заказа).
   */
  @RateLimit('forms')
  @Post('orders/:token/pay')
  @HttpCode(200)
  @ApiQuery({ name: 'locale', required: false, enum: LOCALES })
  @ApiOkResponse({ type: CertificateOrderStatusDto })
  async pay(@Param('token') token: string, @RequestLocale() locale: Locale): Promise<CertificateOrderStatusDto> {
    await this.retryPayment.execute(token);
    return CertificateOrderStatusDto.from(await this.queries.orderStatus(token), locale);
  }

  /** Проверка баланса по коду. Лимит частоты + блокировка IP после 20 неудач за час. */
  @RateLimit('certificate_check')
  @Post('check')
  @HttpCode(200)
  @ApiQuery({ name: 'locale', required: false, enum: LOCALES })
  @ApiOkResponse({ type: CertificateBalanceDto })
  async check(@Body() dto: CheckCertificateDto): Promise<CertificateBalanceDto> {
    return CertificateBalanceDto.from(await this.giftCertificates.check(dto.code));
  }
}
