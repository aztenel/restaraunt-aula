import { BanquetModule } from './banquet/banquet.module';
import { CatalogModule } from './catalog/catalog.module';
import { CustomersModule } from './customers/customers.module';
import { IdentityModule } from './identity/identity.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrderingModule } from './ordering/ordering.module';
import { PaymentsModule } from './payments/payments.module';
import { PosModule } from './pos/pos.module';
import { ReportingModule } from './reporting/reporting.module';
import { ReservationModule } from './reservation/reservation.module';

/** Доменные модули приложения. Каждый — отдельная граница в коде. */
export const DOMAIN_MODULES = [
  IdentityModule,
  NotificationsModule,
  CustomersModule,
  CatalogModule,
  PaymentsModule,
  OrderingModule,
  ReservationModule,
  BanquetModule,
  ReportingModule,
  PosModule,
];
