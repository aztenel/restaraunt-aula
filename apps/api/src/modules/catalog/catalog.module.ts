import { Global, Module } from '@nestjs/common';
import {
  AddDishToBranchMenu,
  BulkAddDishesToBranchMenu,
  BulkSetBranchPrices,
  CopyBranchMenu,
  RemoveDishFromBranchMenu,
  SetBranchDishPrice,
} from './application/branch-menu.actions';
import { CatalogAdminQueries } from './application/catalog-admin.queries';
import { CatalogEventPublisher } from './application/catalog-events';
import {
  CreateCategory,
  DeleteCategory,
  RemoveCategoryImage,
  ReorderCategories,
  SetCategoryImage,
  UpdateCategory,
} from './application/category.actions';
import { ContentAdminQueries } from './application/content-admin.queries';
import { ContentPublicQueries } from './application/content-public.queries';
import {
  CreateBanner,
  CreatePage,
  CreatePromotion,
  DeleteBanner,
  DeletePage,
  DeletePromotion,
  SetBannerImage,
  SetPromotionImage,
  RemoveBannerImage,
  RemovePromotionImage,
  PreviewPageHtml,
  UpdateBanner,
  UpdatePage,
  UpdatePromotion,
} from './application/content.actions';
import { MenuPricingService, MenuQueryService, StopListControlService } from './application/contract-services';
import { AddDishPhotos, DeleteDishPhoto, ReorderDishPhotos } from './application/dish-photo.actions';
import { CreateDish, DeleteDish, UpdateDish } from './application/dish.actions';
import { ImageUrls } from './application/image-urls';
import { MenuSnapshotLoader } from './application/menu-snapshot';
import { CreateModifierGroup, DeleteModifierGroup, UpdateModifierGroup } from './application/modifier.actions';
import { RestoreExpiredStops, SetDishAvailability } from './application/stop-list.actions';
import { StorefrontQueries } from './application/storefront.queries';
import { TranslationReportQuery } from './application/translation-report.query';
import { StopListFeedHandler } from './handlers/stop-list-feed.handler';
import { StopListScheduler } from './handlers/stop-list.scheduler';
import { AdminBranchMenuController } from './http/admin/branch-menu.controller';
import { AdminBannersController, AdminPagesController, AdminPromotionsController } from './http/admin/content.controller';
import {
  AdminCatalogReferenceController,
  AdminCategoriesController,
  AdminDishesController,
  AdminModifierGroupsController,
} from './http/admin/menu.controller';
import { PublicContentController } from './http/public/content.controller';
import { PublicMenuController } from './http/public/menu.controller';
import { BranchMenuRepository } from './infrastructure/branch-menu.repository';
import { CategoryRepository } from './infrastructure/category.repository';
import { BannerRepository, PageRepository, PromotionRepository } from './infrastructure/content.repository';
import { DishRepository } from './infrastructure/dish.repository';
import { ImageProcessor } from './infrastructure/image-processor';
import { MenuReadRepository } from './infrastructure/menu-read.repository';
import { ModifierRepository } from './infrastructure/modifier.repository';
import { MenuPricing, MenuQuery, StopListControl } from './public';

/**
 * Catalog: витрина и меню — категории, блюда (без цены), модификаторы, меню филиалов
 * (цены и стоп-лист в разрезе филиала), поиск, контент витрины (баннеры, акции, страницы).
 * Публичный контракт: MenuPricing, MenuQuery, StopListControl, события CatalogEvents.
 * Внешних интеграций у модуля нет (POS синхронизирует стоп-лист через StopListControl).
 */
@Global()
@Module({
  controllers: [
    AdminCategoriesController,
    AdminDishesController,
    AdminModifierGroupsController,
    AdminCatalogReferenceController,
    AdminBranchMenuController,
    AdminBannersController,
    AdminPromotionsController,
    AdminPagesController,
    PublicMenuController,
    PublicContentController,
  ],
  providers: [
    // Инфраструктура
    CategoryRepository,
    DishRepository,
    ModifierRepository,
    BranchMenuRepository,
    MenuReadRepository,
    BannerRepository,
    PromotionRepository,
    PageRepository,
    ImageProcessor,
    // Приложение: общие сервисы
    ImageUrls,
    CatalogEventPublisher,
    MenuSnapshotLoader,
    // Действия
    CreateCategory,
    UpdateCategory,
    DeleteCategory,
    ReorderCategories,
    SetCategoryImage,
    RemoveCategoryImage,
    CreateDish,
    UpdateDish,
    DeleteDish,
    AddDishPhotos,
    DeleteDishPhoto,
    ReorderDishPhotos,
    CreateModifierGroup,
    UpdateModifierGroup,
    DeleteModifierGroup,
    AddDishToBranchMenu,
    BulkAddDishesToBranchMenu,
    RemoveDishFromBranchMenu,
    SetBranchDishPrice,
    BulkSetBranchPrices,
    CopyBranchMenu,
    SetDishAvailability,
    RestoreExpiredStops,
    CreateBanner,
    UpdateBanner,
    DeleteBanner,
    SetBannerImage,
    RemoveBannerImage,
    RemovePromotionImage,
    PreviewPageHtml,
    CreatePromotion,
    UpdatePromotion,
    DeletePromotion,
    SetPromotionImage,
    CreatePage,
    UpdatePage,
    DeletePage,
    // Запросы
    CatalogAdminQueries,
    ContentAdminQueries,
    ContentPublicQueries,
    StorefrontQueries,
    TranslationReportQuery,
    // Расписания
    StopListScheduler,
    StopListFeedHandler,
    // Публичный контракт
    { provide: MenuPricing, useClass: MenuPricingService },
    { provide: MenuQuery, useClass: MenuQueryService },
    { provide: StopListControl, useClass: StopListControlService },
  ],
  exports: [MenuPricing, MenuQuery, StopListControl],
})
export class CatalogModule {}
