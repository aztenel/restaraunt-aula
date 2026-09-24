import { Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Money } from '../../../shared/kernel/money';
import { Translatable } from '../../../shared/kernel/translatable';
import { CertificateKind } from '../public';
import { moneyOf } from './payment.repository';
import { CertificateProductsTable, PaymentsTables } from './payments.tables';

export interface CertificateDesign {
  /** Основной цвет макета (#RRGGBB). */
  color: string;
  /** Тема оформления: classic, festive, minimal… (для витрины и PDF). */
  theme: string;
  /** Картинка карточки на витрине (необязательно). */
  imageUrl: string | null;
}

export const DEFAULT_DESIGN: CertificateDesign = { color: '#7a4b2a', theme: 'classic', imageUrl: null };

export interface CertificateProduct {
  id: string;
  slug: string;
  kind: CertificateKind;
  name: Translatable;
  /** Описание; для набора — состав набора. */
  description: Translatable;
  nominal: Money;
  price: Money;
  validityMonths: number;
  design: CertificateDesign;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export type CertificateProductWrite = Omit<CertificateProduct, 'id' | 'createdAt' | 'updatedAt'>;

function mapProduct(row: Selectable<CertificateProductsTable>): CertificateProduct {
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind as CertificateKind,
    name: (row.name as Translatable) ?? {},
    description: (row.description as Translatable) ?? {},
    nominal: moneyOf(row.nominal_amount, row.nominal_currency),
    price: moneyOf(row.price_amount, row.price_currency),
    validityMonths: row.validity_months,
    design: { ...DEFAULT_DESIGN, ...((row.design as Partial<CertificateDesign>) ?? {}) },
    isActive: row.is_active,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class CertificateProductRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<PaymentsTables>();
  }

  async findById(id: string): Promise<CertificateProduct | null> {
    const row = await this.db()
      .selectFrom('payments.certificate_products')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? mapProduct(row) : null;
  }

  async findBySlug(slug: string, exceptId?: string): Promise<CertificateProduct | null> {
    let q = this.db().selectFrom('payments.certificate_products').selectAll().where('slug', '=', slug).where('deleted_at', 'is', null);
    if (exceptId) q = q.where('id', '!=', exceptId);
    const row = await q.executeTakeFirst();
    return row ? mapProduct(row) : null;
  }

  async list(options: { activeOnly: boolean }): Promise<CertificateProduct[]> {
    let q = this.db().selectFrom('payments.certificate_products').selectAll().where('deleted_at', 'is', null);
    if (options.activeOnly) q = q.where('is_active', '=', true);
    const rows = await q.orderBy('sort_order').orderBy('nominal_amount').orderBy('slug').execute();
    return rows.map(mapProduct);
  }

  async insert(id: string, data: CertificateProductWrite): Promise<void> {
    await this.db()
      .insertInto('payments.certificate_products')
      .values({ id, ...this.toRow(data), deleted_at: null })
      .execute();
  }

  async update(id: string, data: CertificateProductWrite): Promise<void> {
    await this.db().updateTable('payments.certificate_products').set(this.toRow(data)).where('id', '=', id).execute();
  }

  async softDelete(id: string, now: Date): Promise<void> {
    await this.db().updateTable('payments.certificate_products').set({ deleted_at: now, is_active: false }).where('id', '=', id).execute();
  }

  private toRow(data: CertificateProductWrite) {
    return {
      slug: data.slug,
      kind: data.kind,
      name: JSON.stringify(data.name),
      description: JSON.stringify(data.description),
      nominal_amount: data.nominal.amount,
      nominal_currency: data.nominal.currency,
      price_amount: data.price.amount,
      price_currency: data.price.currency,
      validity_months: data.validityMonths,
      design: JSON.stringify(data.design),
      is_active: data.isActive,
      sort_order: data.sortOrder,
    };
  }
}
