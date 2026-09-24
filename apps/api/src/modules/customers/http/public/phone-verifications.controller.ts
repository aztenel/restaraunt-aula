import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ClientIp, Public, RequestLocale } from '../../../../shared/infrastructure/http/decorators';
import { RateLimit } from '../../../../shared/infrastructure/rate-limit/rate-limit.guard';
import { Locale } from '../../../../shared/kernel/translatable';
import { StartPhoneVerification, VerifyPhoneCode } from '../../application/phone-verification.actions';
import { PhoneVerificationStartedDto, PhoneVerifiedDto, StartPhoneVerificationDto, VerifyPhoneCodeDto } from '../dto';

/**
 * Подтверждение телефона SMS-кодом (оплата при получении, бронь без депозита — по настройке филиала).
 * Токен из ответа передаётся при оформлении заказа/брони.
 */
@ApiTags('public')
@Public()
@Controller('public/phone-verifications')
export class PublicPhoneVerificationsController {
  constructor(
    private readonly start: StartPhoneVerification,
    private readonly verify: VerifyPhoneCode,
  ) {}

  /**
   * Отправить код. Лимиты: на IP (политика otp) и на номер (раз в 60 с, 5 в час).
   * Язык SMS — locale из тела, иначе язык запроса (?locale, X-Locale, Accept-Language).
   */
  @Post()
  @RateLimit('otp')
  @ApiCreatedResponse({ type: PhoneVerificationStartedDto })
  create(
    @Body() dto: StartPhoneVerificationDto,
    @RequestLocale() requestLocale: Locale,
    @ClientIp() ip: string | null,
  ): Promise<PhoneVerificationStartedDto> {
    return this.start.execute(dto.phone, dto.locale ?? requestLocale, ip);
  }

  /** Проверить код (не больше 5 попыток на код) -> токен подтверждения на 30 минут. */
  @Post(':id/verify')
  @HttpCode(200)
  @RateLimit('forms')
  @ApiOkResponse({ type: PhoneVerifiedDto })
  check(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyPhoneCodeDto): Promise<PhoneVerifiedDto> {
    return this.verify.execute(id, dto.code);
  }
}
