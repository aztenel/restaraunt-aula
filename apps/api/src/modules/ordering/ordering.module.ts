import { Global, Module, OnModuleInit } from '@nestjs/common';
import { IntegrationCatalog } from '../../shared/infrastructure/settings/integration-catalog';
import { AdvanceOrderByCourier } from './application/advance-order-by-courier.action';
import { AnonymizeCustomerOrders } from './application/anonymize-customer-orders.action';
import { AutoCancelUnpaidOrders } from './application/auto-cancel-unpaid-orders.action';
import {
  CancelCourierClaim,
  CancelCourierDispatch,
  CreateCourierClaim,
  PollCourierDispatch,
  RetryCourierDispatch,
} from './application/courier-dispatch.actions';
import { COURIER_DISPATCHERS, CourierDispatchRegistry, courierRoutingDescriptor } from './application/courier-dispatch.registry';
import { RequestCourierDispatch, ScheduleCourierCancellation } from './application/courier-requests';
import { CreateDeliveryZone, DeleteDeliveryZone, UpdateDeliveryZone } from './application/delivery-zone.actions';
import { DeliveryQueries } from './application/delivery.queries';
import { OrderCertificateCheck } from './application/order-certificate';
import { OrderLinks } from './application/order-links';
import { ApplyOrderPayment, ApplyOrderRefundResult } from './application/order-payment-events.actions';
import { OrderPaymentState } from './application/order-payment-state';
import { OrderPricing } from './application/order-pricing';
import { OrderQueryService } from './application/order-query.service';
import { OrderQueries } from './application/order.queries';
import { CancelOrder, RefundOrder, RejectOrder, TransitionOrder } from './application/order-staff.actions';
import { OrderTransitionRecorder } from './application/order-transition-recorder';
import { PlaceOrder } from './application/place-order.action';
import { CreatePromoCode, DeletePromoCode, UpdatePromoCode } from './application/promo-code.actions';
import { PromoCodeQueries } from './application/promo-code.queries';
import { QuoteOrder } from './application/quote-order.action';
import { RequestOrderRefunds } from './application/request-order-refunds';
import { RetryOrderPayment } from './application/retry-order-payment.action';
import { SettleCancelledOrder } from './application/settle-cancelled-order';
import { CourierDispatch } from './domain/courier-dispatch';
import { OrderingCustomerHandlers } from './handlers/ordering-customer.handlers';
import { OrderingJobsHandler } from './handlers/ordering-jobs.handler';
import { OrderingPaymentHandlers } from './handlers/ordering-payment.handlers';
import { AdminDeliveryZonesController } from './http/admin/delivery-zones.controller';
import { AdminOrdersController } from './http/admin/orders.controller';
import { AdminPromoCodesController } from './http/admin/promo-codes.controller';
import { PublicDeliveryController } from './http/public/delivery.controller';
import { PublicOrdersController } from './http/public/orders.controller';
import { OwnCourierDispatch } from './infrastructure/adapters/own/own-courier.dispatch';
import { YandexCourierDispatch } from './infrastructure/adapters/yandex/yandex-delivery.dispatch';
import { YANDEX_DELIVERY_INTEGRATION } from './infrastructure/adapters/yandex/yandex-delivery.settings';
import { CourierDispatchRepository } from './infrastructure/courier-dispatch.repository';
import { DeliveryZoneRepository } from './infrastructure/delivery-zone.repository';
import { OrderPaymentsRepository } from './infrastructure/order-payments.repository';
import { OrderRepository } from './infrastructure/order.repository';
import { PromoCodeRepository } from './infrastructure/promo-code.repository';
import { OrderQuery } from './public';

/**
 * Ordering: заказ доставки и самовывоза (ТЗ, раздел 2) — корзина и расчёт на сервере, оформление,
 * автомат статусов строго по схеме ТЗ, оплата онлайн / при получении / сертификатом, возвраты,
 * зоны доставки и выбор филиала по точке, время заказа, промокоды, курьеры (свои и служба доставки).
 * Публичный контракт — OrderQuery (заказ для кухни/POS) и события OrderingEvents.
 */
@Global()
@Module({
  controllers: [PublicOrdersController, PublicDeliveryController, AdminOrdersController, AdminDeliveryZonesController, AdminPromoCodesController],
  providers: [
    // Хранилище
    OrderRepository,
    OrderPaymentsRepository,
    DeliveryZoneRepository,
    PromoCodeRepository,
    CourierDispatchRepository,
    // Службы курьеров (интерфейс CourierDispatch): свои курьеры по умолчанию и служба доставки
    OwnCourierDispatch,
    YandexCourierDispatch,
    {
      provide: COURIER_DISPATCHERS,
      useFactory: (own: OwnCourierDispatch, yandex: YandexCourierDispatch): CourierDispatch[] => [own, yandex],
      inject: [OwnCourierDispatch, YandexCourierDispatch],
    },
    CourierDispatchRegistry,
    // Общие части действий
    OrderLinks,
    OrderPricing,
    OrderPaymentState,
    OrderCertificateCheck,
    OrderTransitionRecorder,
    RequestOrderRefunds,
    SettleCancelledOrder,
    RequestCourierDispatch,
    ScheduleCourierCancellation,
    // Действия
    QuoteOrder,
    PlaceOrder,
    RetryOrderPayment,
    TransitionOrder,
    CancelOrder,
    RejectOrder,
    RefundOrder,
    ApplyOrderPayment,
    ApplyOrderRefundResult,
    AutoCancelUnpaidOrders,
    AnonymizeCustomerOrders,
    CreateDeliveryZone,
    UpdateDeliveryZone,
    DeleteDeliveryZone,
    CreatePromoCode,
    UpdatePromoCode,
    DeletePromoCode,
    AdvanceOrderByCourier,
    CreateCourierClaim,
    PollCourierDispatch,
    CancelCourierClaim,
    RetryCourierDispatch,
    CancelCourierDispatch,
    // Запросы
    DeliveryQueries,
    OrderQueries,
    PromoCodeQueries,
    // Публичный контракт
    { provide: OrderQuery, useClass: OrderQueryService },
    // Подписки, задачи, расписания
    OrderingPaymentHandlers,
    OrderingCustomerHandlers,
    OrderingJobsHandler,
  ],
  exports: [OrderQuery],
})
export class OrderingModule implements OnModuleInit {
  constructor(
    private readonly catalog: IntegrationCatalog,
    private readonly couriers: CourierDispatchRegistry,
  ) {}

  onModuleInit(): void {
    this.catalog.register(YANDEX_DELIVERY_INTEGRATION);
    this.catalog.register(courierRoutingDescriptor(this.couriers.providers()));
  }
}
