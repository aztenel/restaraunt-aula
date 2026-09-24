import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public, RequestLocale } from '../../../../shared/infrastructure/http/decorators';
import { Locale, LOCALES } from '../../../../shared/kernel/translatable';
import { ConsentTextQueries } from '../../application/customers.queries';
import { ConsentKindParamDto, PublicConsentTextDto } from '../dto';

/** Действующий текст согласия для форм витрины (заказ, бронь, банкетная заявка). */
@ApiTags('public')
@Public()
@Controller('public/consents')
export class PublicConsentsController {
  constructor(private readonly queries: ConsentTextQueries) {}

  @Get(':kind')
  @ApiQuery({ name: 'locale', required: false, enum: LOCALES })
  @ApiOkResponse({ type: PublicConsentTextDto })
  current(@Param() params: ConsentKindParamDto, @RequestLocale() locale: Locale): Promise<PublicConsentTextDto> {
    return this.queries.current(params.kind, locale);
  }
}
