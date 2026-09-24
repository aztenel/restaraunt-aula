import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { Permission } from '../../../../shared/kernel/permissions';
import { ContentAdminQueries } from '../../application/content-admin.queries';
import {
  BannerInput,
  CreateBanner,
  CreatePage,
  CreatePromotion,
  DeleteBanner,
  DeletePage,
  DeletePromotion,
  PromotionInput,
  SetBannerImage,
  SetPromotionImage,
  UpdateBanner,
  UpdatePage,
  UpdatePromotion,
} from '../../application/content.actions';
import { MAX_IMAGE_BYTES } from '../../domain/images';
import { UploadedImage } from '../../infrastructure/image-processor';
import {
  BannerDto,
  BannerInputDto,
  BannerListQueryDto,
  PageDto,
  PageInputDto,
  PromotionDto,
  PromotionInputDto,
} from '../dto/content-admin.dto';
import { requireImage, SINGLE_IMAGE_BODY } from '../uploads';

function date(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(value);
}

function toBannerInput(dto: BannerInputDto): BannerInput {
  return { ...dto, activeFrom: date(dto.activeFrom), activeTo: date(dto.activeTo) };
}

function toPromotionInput(dto: PromotionInputDto): PromotionInput {
  return { ...dto, validFrom: date(dto.validFrom), validTo: date(dto.validTo) };
}

@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/content/banners')
export class AdminBannersController {
  constructor(
    private readonly queries: ContentAdminQueries,
    private readonly createBanner: CreateBanner,
    private readonly updateBanner: UpdateBanner,
    private readonly deleteBanner: DeleteBanner,
    private readonly setImage: SetBannerImage,
  ) {}

  @RequirePermissions(Permission.ContentManage)
  @Get()
  @ApiOkResponse({ type: [BannerDto] })
  list(@CurrentActor() actor: Actor, @Query() query: BannerListQueryDto): Promise<BannerDto[]> {
    return this.queries.bannerList(actor, { placement: query.placement, branchId: query.branchId });
  }

  @RequirePermissions(Permission.ContentManage)
  @Get(':id')
  @ApiOkResponse({ type: BannerDto })
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<BannerDto> {
    return this.queries.banner(actor, id);
  }

  @RequirePermissions(Permission.ContentManage)
  @Post()
  @ApiCreatedResponse({ type: BannerDto })
  async create(@CurrentActor() actor: Actor, @Body() dto: BannerInputDto): Promise<BannerDto> {
    const id = await this.createBanner.execute(actor, toBannerInput(dto));
    return this.queries.banner(actor, id);
  }

  @RequirePermissions(Permission.ContentManage)
  @Put(':id')
  @ApiOkResponse({ type: BannerDto })
  async update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BannerInputDto): Promise<BannerDto> {
    await this.updateBanner.execute(actor, id, toBannerInput(dto));
    return this.queries.banner(actor, id);
  }

  @RequirePermissions(Permission.ContentManage)
  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deleteBanner.execute(actor, id);
  }

  @RequirePermissions(Permission.ContentManage)
  @Post(':id/image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody(SINGLE_IMAGE_BODY)
  @ApiCreatedResponse({ type: BannerDto, description: 'webp 1920/1200/600' })
  async uploadImage(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<BannerDto> {
    await this.setImage.execute(actor, id, requireImage(file));
    return this.queries.banner(actor, id);
  }
}

@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/content/promotions')
export class AdminPromotionsController {
  constructor(
    private readonly queries: ContentAdminQueries,
    private readonly createPromotion: CreatePromotion,
    private readonly updatePromotion: UpdatePromotion,
    private readonly deletePromotion: DeletePromotion,
    private readonly setImage: SetPromotionImage,
  ) {}

  @RequirePermissions(Permission.ContentManage)
  @Get()
  @ApiOkResponse({ type: [PromotionDto] })
  list(@CurrentActor() actor: Actor): Promise<PromotionDto[]> {
    return this.queries.promotionList(actor);
  }

  @RequirePermissions(Permission.ContentManage)
  @Get(':id')
  @ApiOkResponse({ type: PromotionDto })
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<PromotionDto> {
    return this.queries.promotion(actor, id);
  }

  @RequirePermissions(Permission.ContentManage)
  @Post()
  @ApiCreatedResponse({ type: PromotionDto })
  async create(@CurrentActor() actor: Actor, @Body() dto: PromotionInputDto): Promise<PromotionDto> {
    const id = await this.createPromotion.execute(actor, toPromotionInput(dto));
    return this.queries.promotion(actor, id);
  }

  @RequirePermissions(Permission.ContentManage)
  @Put(':id')
  @ApiOkResponse({ type: PromotionDto })
  async update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PromotionInputDto): Promise<PromotionDto> {
    await this.updatePromotion.execute(actor, id, toPromotionInput(dto));
    return this.queries.promotion(actor, id);
  }

  @RequirePermissions(Permission.ContentManage)
  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deletePromotion.execute(actor, id);
  }

  @RequirePermissions(Permission.ContentManage)
  @Post(':id/image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody(SINGLE_IMAGE_BODY)
  @ApiCreatedResponse({ type: PromotionDto })
  async uploadImage(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<PromotionDto> {
    await this.setImage.execute(actor, id, requireImage(file));
    return this.queries.promotion(actor, id);
  }
}

@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/content/pages')
export class AdminPagesController {
  constructor(
    private readonly queries: ContentAdminQueries,
    private readonly createPage: CreatePage,
    private readonly updatePage: UpdatePage,
    private readonly deletePage: DeletePage,
  ) {}

  @RequirePermissions(Permission.ContentManage)
  @Get()
  @ApiOkResponse({ type: [PageDto] })
  list(@CurrentActor() actor: Actor): Promise<PageDto[]> {
    return this.queries.pageList(actor);
  }

  @RequirePermissions(Permission.ContentManage)
  @Get(':id')
  @ApiOkResponse({ type: PageDto })
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<PageDto> {
    return this.queries.page(actor, id);
  }

  @RequirePermissions(Permission.ContentManage)
  @Post()
  @ApiCreatedResponse({ type: PageDto })
  async create(@CurrentActor() actor: Actor, @Body() dto: PageInputDto): Promise<PageDto> {
    const id = await this.createPage.execute(actor, dto);
    return this.queries.page(actor, id);
  }

  @RequirePermissions(Permission.ContentManage)
  @Put(':id')
  @ApiOkResponse({ type: PageDto })
  async update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PageInputDto): Promise<PageDto> {
    await this.updatePage.execute(actor, id, dto);
    return this.queries.page(actor, id);
  }

  @RequirePermissions(Permission.ContentManage)
  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deletePage.execute(actor, id);
  }
}
