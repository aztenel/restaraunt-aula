import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { MoneyInputDto } from '../../../../shared/infrastructure/http/api-types';
import { Actor } from '../../../../shared/kernel/actor';
import { pageRequest } from '../../../../shared/kernel/pagination';
import { Permission } from '../../../../shared/kernel/permissions';
import { isLocale, Locale } from '../../../../shared/kernel/translatable';
import { CatalogAdminQueries } from '../../application/catalog-admin.queries';
import {
  CreateCategory,
  DeleteCategory,
  RemoveCategoryImage,
  ReorderCategories,
  SetCategoryImage,
  UpdateCategory,
} from '../../application/category.actions';
import { AddDishPhotos, DeleteDishPhoto, ReorderDishPhotos } from '../../application/dish-photo.actions';
import { CreateDish, DeleteDish, UpdateDish } from '../../application/dish.actions';
import { CreateModifierGroup, DeleteModifierGroup, ModifierGroupInput, UpdateModifierGroup } from '../../application/modifier.actions';
import { TranslationEntityType, TranslationReportQuery } from '../../application/translation-report.query';
import { MAX_IMAGE_BYTES, MAX_PHOTOS_PER_DISH } from '../../domain/images';
import { UploadedImage } from '../../infrastructure/image-processor';
import {
  AllergenRefDto,
  CategoryDto,
  CategoryInputDto,
  DishDto,
  DishesPageDto,
  DishInputDto,
  DishListQueryDto,
  ModifierGroupDto,
  ModifierGroupInputDto,
  PhotoOrderDto,
  ReorderDto,
  TranslationReportDto,
  TranslationReportQueryDto,
} from '../dto/menu-admin.dto';
import { MULTI_IMAGE_BODY, requireImage, SINGLE_IMAGE_BODY } from '../uploads';

const READ = [Permission.MenuContent, Permission.MenuPrices, Permission.MenuStopList];

function toModifierInput(dto: ModifierGroupInputDto): ModifierGroupInput {
  return { ...dto, options: dto.options.map((o) => ({ ...o, price: MoneyInputDto.toMoney(o.price) })) };
}

@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/catalog/categories')
export class AdminCategoriesController {
  constructor(
    private readonly queries: CatalogAdminQueries,
    private readonly createCategory: CreateCategory,
    private readonly updateCategory: UpdateCategory,
    private readonly deleteCategory: DeleteCategory,
    private readonly reorderCategories: ReorderCategories,
    private readonly setImage: SetCategoryImage,
    private readonly removeImage: RemoveCategoryImage,
  ) {}

  @RequirePermissions(...READ)
  @Get()
  @ApiOkResponse({ type: [CategoryDto] })
  list(@CurrentActor() actor: Actor): Promise<CategoryDto[]> {
    return this.queries.categoryList(actor);
  }

  @RequirePermissions(...READ)
  @Get(':id')
  @ApiOkResponse({ type: CategoryDto })
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<CategoryDto> {
    return this.queries.category(actor, id);
  }

  @RequirePermissions(Permission.MenuContent)
  @Post()
  @ApiCreatedResponse({ type: CategoryDto })
  async create(@CurrentActor() actor: Actor, @Body() dto: CategoryInputDto): Promise<CategoryDto> {
    const id = await this.createCategory.execute(actor, dto);
    return this.queries.category(actor, id);
  }

  /** Порядок категорий в меню (до маршрута :id). */
  @RequirePermissions(Permission.MenuContent)
  @Put('order')
  @ApiOkResponse({ type: [CategoryDto] })
  async reorder(@CurrentActor() actor: Actor, @Body() dto: ReorderDto): Promise<CategoryDto[]> {
    await this.reorderCategories.execute(actor, dto.ids);
    return this.queries.categoryList(actor);
  }

  @RequirePermissions(Permission.MenuContent)
  @Put(':id')
  @ApiOkResponse({ type: CategoryDto })
  async update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CategoryInputDto): Promise<CategoryDto> {
    await this.updateCategory.execute(actor, id, dto);
    return this.queries.category(actor, id);
  }

  @RequirePermissions(Permission.MenuContent)
  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deleteCategory.execute(actor, id);
  }

  @RequirePermissions(Permission.MenuContent)
  @Post(':id/image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody(SINGLE_IMAGE_BODY)
  @ApiCreatedResponse({ type: CategoryDto })
  async uploadImage(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<CategoryDto> {
    await this.setImage.execute(actor, id, requireImage(file));
    return this.queries.category(actor, id);
  }

  @RequirePermissions(Permission.MenuContent)
  @Delete(':id/image')
  @ApiOkResponse({ type: CategoryDto })
  async deleteImage(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<CategoryDto> {
    await this.removeImage.execute(actor, id);
    return this.queries.category(actor, id);
  }
}

@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/catalog/dishes')
export class AdminDishesController {
  constructor(
    private readonly queries: CatalogAdminQueries,
    private readonly createDish: CreateDish,
    private readonly updateDish: UpdateDish,
    private readonly deleteDish: DeleteDish,
    private readonly addPhotos: AddDishPhotos,
    private readonly deletePhoto: DeleteDishPhoto,
    private readonly reorderPhotos: ReorderDishPhotos,
  ) {}

  @RequirePermissions(...READ)
  @Get()
  @ApiOkResponse({ type: DishesPageDto })
  list(@CurrentActor() actor: Actor, @Query() query: DishListQueryDto): Promise<DishesPageDto> {
    return this.queries.dishPage(
      actor,
      { q: query.q, categoryId: query.categoryId, isActive: query.isActive, notInBranchId: query.notInBranchId },
      pageRequest(query.page, query.perPage),
    );
  }

  @RequirePermissions(...READ)
  @Get(':id')
  @ApiOkResponse({ type: DishDto })
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<DishDto> {
    return this.queries.dish(actor, id);
  }

  @RequirePermissions(Permission.MenuContent)
  @Post()
  @ApiCreatedResponse({ type: DishDto })
  async create(@CurrentActor() actor: Actor, @Body() dto: DishInputDto): Promise<DishDto> {
    const id = await this.createDish.execute(actor, dto);
    return this.queries.dish(actor, id);
  }

  @RequirePermissions(Permission.MenuContent)
  @Put(':id')
  @ApiOkResponse({ type: DishDto })
  async update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DishInputDto): Promise<DishDto> {
    await this.updateDish.execute(actor, id, dto);
    return this.queries.dish(actor, id);
  }

  @RequirePermissions(Permission.MenuContent)
  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deleteDish.execute(actor, id);
  }

  @RequirePermissions(Permission.MenuContent)
  @Post(':id/photos')
  @UseInterceptors(FilesInterceptor('files', MAX_PHOTOS_PER_DISH, { limits: { fileSize: MAX_IMAGE_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody(MULTI_IMAGE_BODY)
  @ApiCreatedResponse({ type: DishDto, description: 'JPEG/PNG/WebP до 10 МБ, от 300 px по ширине; сохраняются webp 1200/600/300' })
  async uploadPhotos(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: UploadedImage[] | undefined,
  ): Promise<DishDto> {
    await this.addPhotos.execute(actor, id, files ?? []);
    return this.queries.dish(actor, id);
  }

  @RequirePermissions(Permission.MenuContent)
  @Delete(':id/photos/:photoId')
  @ApiOkResponse({ type: DishDto })
  async removePhoto(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ): Promise<DishDto> {
    await this.deletePhoto.execute(actor, id, photoId);
    return this.queries.dish(actor, id);
  }

  @RequirePermissions(Permission.MenuContent)
  @Put(':id/photos/order')
  @ApiOkResponse({ type: DishDto })
  async orderPhotos(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PhotoOrderDto): Promise<DishDto> {
    await this.reorderPhotos.execute(actor, id, dto.photoIds);
    return this.queries.dish(actor, id);
  }
}

@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/catalog/modifier-groups')
export class AdminModifierGroupsController {
  constructor(
    private readonly queries: CatalogAdminQueries,
    private readonly createGroup: CreateModifierGroup,
    private readonly updateGroup: UpdateModifierGroup,
    private readonly deleteGroup: DeleteModifierGroup,
  ) {}

  @RequirePermissions(...READ)
  @Get()
  @ApiOkResponse({ type: [ModifierGroupDto] })
  list(@CurrentActor() actor: Actor): Promise<ModifierGroupDto[]> {
    return this.queries.modifierGroupList(actor);
  }

  @RequirePermissions(...READ)
  @Get(':id')
  @ApiOkResponse({ type: ModifierGroupDto })
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<ModifierGroupDto> {
    return this.queries.modifierGroup(actor, id);
  }

  @RequirePermissions(Permission.MenuContent)
  @Post()
  @ApiCreatedResponse({ type: ModifierGroupDto })
  async create(@CurrentActor() actor: Actor, @Body() dto: ModifierGroupInputDto): Promise<ModifierGroupDto> {
    const id = await this.createGroup.execute(actor, toModifierInput(dto));
    return this.queries.modifierGroup(actor, id);
  }

  @RequirePermissions(Permission.MenuContent)
  @Put(':id')
  @ApiOkResponse({ type: ModifierGroupDto })
  async update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModifierGroupInputDto,
  ): Promise<ModifierGroupDto> {
    await this.updateGroup.execute(actor, id, toModifierInput(dto));
    return this.queries.modifierGroup(actor, id);
  }

  @RequirePermissions(Permission.MenuContent)
  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deleteGroup.execute(actor, id);
  }
}

@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/catalog')
export class AdminCatalogReferenceController {
  constructor(
    private readonly queries: CatalogAdminQueries,
    private readonly translationReport: TranslationReportQuery,
  ) {}

  /** Справочник аллергенов (коды и подписи kk/ru/en). */
  @RequirePermissions(...READ)
  @Get('allergens')
  @ApiOkResponse({ type: [AllergenRefDto] })
  allergens(): AllergenRefDto[] {
    return this.queries.allergens();
  }

  /** Полнота переводов: какие блюда, категории, модификаторы и тексты не переведены на kk или ru. */
  @RequirePermissions(Permission.MenuContent, Permission.ContentManage)
  @Get('translations')
  @ApiOkResponse({ type: TranslationReportDto })
  translations(@CurrentActor() actor: Actor, @Query() query: TranslationReportQueryDto): Promise<TranslationReportDto> {
    const locales = query.locales
      ?.split(',')
      .map((l) => l.trim())
      .filter((l): l is Locale => isLocale(l));
    return this.translationReport.execute(actor, { locales, entityType: (query.entityType as TranslationEntityType | undefined) ?? null });
  }
}
