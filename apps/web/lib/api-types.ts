/**
 * Уточнённые типы публичных ответов API для витрины.
 *
 * В docs/openapi.json nullable-поля без явного `type` (вес, ссылки, даты, paymentUrl) выводятся
 * openapi-typescript как `Record<string, never> | null`. Здесь — типы, совпадающие с DTO бэкенда
 * (apps/api/src/modules/catalog/http/dto/public.dto.ts, payments/http/certificates.dto.ts).
 * Типы строятся ОТ сгенерированной схемы (Omit + уточнение), поэтому расхождение со схемой
 * ловит компилятор. Когда DTO получат явные типы, уточнения можно убрать.
 */
import type { components } from '@aula/api-client';

type Schemas = components['schemas'];

/** Заменить поля типа T уточнёнными. */
type Refine<T, R> = Omit<T, keyof R> & R;

export type Money = Schemas['MoneyDto'];

// ---------------------------------------------------------------- Изображения (webp-варианты)

export type ImageVariant = Schemas['ImageVariantDto'];
/** Изображение: url варианта по умолчанию + все webp-варианты (300/600/1200…) для srcset. */
export type ApiImage = Schemas['ImageDto'];

// ---------------------------------------------------------------- Каталог

export type DishAvailability = Schemas['PublicDishCardDto']['availability'];
export type Seo = Schemas['SeoDto'];
export type Allergen = Schemas['AllergenDto'];
export type BranchRef = Schemas['PublicBranchRefDto'];

export type DishCard = Refine<
  Schemas['PublicDishCardDto'],
  {
    weightGrams: number | null;
    calories: number | null;
    photo: ApiImage | null;
  }
>;

export type ModifierOption = Schemas['PublicModifierOptionDto'];
export type ModifierGroup = Schemas['PublicModifierGroupDto'];

export type DishDetail = Refine<
  Schemas['PublicDishDetailDto'],
  {
    weightGrams: number | null;
    calories: number | null;
    photo: ApiImage | null;
  }
>;

export type Category = Refine<Schemas['PublicCategoryDto'], { image: ApiImage | null }>;
export type MenuCategory = Category & { dishes: DishCard[] };

export type BranchMenu = Refine<Schemas['PublicMenuDto'], { categories: MenuCategory[] }>;

export type CategoryPage = Refine<
  Schemas['PublicCategoryPageDto'],
  { category: Category; categories: Category[]; dishes: DishCard[] }
>;

export type DishPage = Refine<Schemas['PublicDishPageDto'], { items: DishCard[] }>;

// ---------------------------------------------------------------- Контент

export type BannerPlacement = Schemas['PublicBannerDto']['placement'];

export type Banner = Refine<Schemas['PublicBannerDto'], { linkUrl: string | null; image: ApiImage | null }>;

export type Promotion = Refine<
  Schemas['PublicPromotionDto'],
  { image: ApiImage | null; validFrom: string | null; validTo: string | null }
>;

export type ContentPage = Schemas['PublicPageDto'];

export type ConsentText = Schemas['PublicConsentTextDto'];
export type ConsentKind = ConsentText['kind'];

// ---------------------------------------------------------------- Сертификаты

export type CertificateProduct = Schemas['PublicCertificateProductDto'];
export type CertificateKind = CertificateProduct['kind'];

export type PaymentLink = Refine<Schemas['PaymentLinkDto'], { paymentUrl: string | null; expiresAt: string | null }>;
export type PaymentStatus = PaymentLink['status'];

export type PurchaseCertificateBody = Schemas['PurchaseCertificateDto'] & {
  consent: { personalData: boolean; marketing?: boolean };
};

export type PurchaseResult = Refine<Schemas['PurchaseResultDto'], { payment: PaymentLink }>;

export type CertificateOrderStatus = Refine<
  Schemas['CertificateOrderStatusDto'],
  { payment: PaymentLink | null; issuedAt: string | null }
>;

export type CertificateBalance = Refine<Schemas['CertificateBalanceDto'], { setDescription: string | null }>;
