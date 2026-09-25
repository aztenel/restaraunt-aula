/**
 * Типы публичных ответов API для витрины — короткие имена для сгенерированной схемы
 * (packages/api-client/src/schema.d.ts из docs/openapi.json; nullable-поля в схеме описаны точно).
 * Уточнений поверх схемы здесь нет: расхождение с API ловит компилятор после регенерации.
 */
import type { components } from '@aula/api-client';

type Schemas = components['schemas'];

export type Money = Schemas['MoneyDto'];
export type GeoPoint = Schemas['GeoPointDto'];

// ---------------------------------------------------------------- Изображения (webp-варианты)

export type ImageVariant = Schemas['ImageVariantDto'];
/** Изображение: url варианта по умолчанию + все webp-варианты (300/600/1200…) для srcset. */
export type ApiImage = Schemas['ImageDto'];

// ---------------------------------------------------------------- Каталог

export type DishAvailability = Schemas['PublicDishCardDto']['availability'];
export type Seo = Schemas['SeoDto'];
export type Allergen = Schemas['AllergenDto'];
export type BranchRef = Schemas['PublicBranchRefDto'];
export type DishCard = Schemas['PublicDishCardDto'];
export type ModifierOption = Schemas['PublicModifierOptionDto'];
export type ModifierGroup = Schemas['PublicModifierGroupDto'];
export type DishDetail = Schemas['PublicDishDetailDto'];
export type Category = Schemas['PublicCategoryDto'];
export type MenuCategory = Schemas['PublicMenuCategoryDto'];
export type BranchMenu = Schemas['PublicMenuDto'];
export type CategoryPage = Schemas['PublicCategoryPageDto'];
export type DishPage = Schemas['PublicDishPageDto'];

// ---------------------------------------------------------------- Контент

export type Banner = Schemas['PublicBannerDto'];
export type BannerPlacement = Banner['placement'];
export type Promotion = Schemas['PublicPromotionDto'];
export type ContentPage = Schemas['PublicPageDto'];
export type ConsentText = Schemas['PublicConsentTextDto'];
export type ConsentKind = ConsentText['kind'];

// ---------------------------------------------------------------- Сертификаты

export type CertificateProduct = Schemas['PublicCertificateProductDto'];
export type CertificateKind = CertificateProduct['kind'];
export type PaymentLink = Schemas['PaymentLinkDto'];
export type PaymentStatus = PaymentLink['status'];
export type PurchaseCertificateBody = Schemas['PurchaseCertificateDto'];
export type PurchaseResult = Schemas['PurchaseResultDto'];
export type CertificateOrderStatus = Schemas['CertificateOrderStatusDto'];
export type CertificateBalance = Schemas['CertificateBalanceDto'];

// ---------------------------------------------------------------- Заказ

export type OrderType = Schemas['QuoteOrderDto']['type'];
export type QuoteOrderBody = Schemas['QuoteOrderDto'];
export type Quote = Schemas['OrderQuoteDto'];
export type QuoteLine = Schemas['OrderQuoteLineDto'];
export type QuoteModifier = Schemas['OrderModifierViewDto'];
export type QuoteDelivery = Schemas['OrderQuoteDeliveryDto'];
export type QuotePromo = Schemas['OrderQuotePromoDto'];
export type QuoteCertificate = Schemas['OrderQuoteCertificateDto'];
export type CheckoutBody = Schemas['OrderCheckoutDto'];
export type CheckoutResult = Schemas['OrderCheckoutResultDto'];
export type OrderTracking = Schemas['OrderTrackingDto'];
export type OrderStatus = OrderTracking['status'];
export type OrderPaymentState = Schemas['OrderPaymentStateDto'];
export type OrderBranch = Schemas['OrderBranchDto'];
export type DeliveryResolution = Schemas['DeliveryResolutionDto'];
export type DeliveryOption = Schemas['DeliveryOptionDto'];
export type DeliveryZone = Schemas['PublicDeliveryZoneDto'];
export type OrderSlots = Schemas['OrderSlotsDto'];

// ---------------------------------------------------------------- Подтверждение телефона

export type PhoneVerificationStarted = Schemas['PhoneVerificationStartedDto'];
export type PhoneVerified = Schemas['PhoneVerifiedDto'];

// ---------------------------------------------------------------- Бронирование

export type Availability = Schemas['AvailabilityDto'];
export type VenueSlot = Schemas['PublicVenueSlotDto'];
export type AlternativeTime = Schemas['AlternativeTimeDto'];
export type HallMap = Schemas['PublicHallMapDto'];
export type Hall = Schemas['PublicHallDto'];
export type MapVenue = Schemas['PublicMapVenueDto'];
export type VenuePosition = Schemas['VenuePositionDto'];
export type BookReservationBody = Schemas['BookReservationDto'];
export type Reservation = Schemas['PublicReservationDto'];
export type ReservationStatus = Reservation['status'];

// ---------------------------------------------------------------- Банкеты

export type BanquetEventType = Schemas['BanquetEventTypeDto'];
export type BanquetRequestBody = Schemas['BanquetPublicCreateRequestDto'];
export type BanquetRequestCreated = Schemas['BanquetPublicRequestCreatedDto'];
export type BanquetQuote = Schemas['BanquetPublicQuoteDto'];
export type BanquetQuoteLine = Schemas['BanquetPublicQuoteLineDto'];
export type BanquetAcceptResult = Schemas['BanquetPublicAcceptResultDto'];
export type BanquetInvoice = Schemas['BanquetPublicInvoiceDto'];
