import { Injectable } from '@nestjs/common';
import { ExpressionBuilder, SelectQueryBuilder, Selectable, sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Currency, Money } from '../../../shared/kernel/money';
import { offsetOf, Page, pageOf, PageRequest } from '../../../shared/kernel/pagination';
import { addDays, startOfLocalDay } from '../../../shared/kernel/time';
import { Locale, parseLocale } from '../../../shared/kernel/translatable';
import { ConsentFlags } from '../domain/consent';
import { EditableProfile } from '../domain/customer';
import { CustomerFilter, escapeLike, phoneSearchPatterns } from '../domain/customer-filter';
import { CustomerAggregates } from '../domain/history';
import { CustomersTable, CustomersTables } from './customers.tables';

export interface CustomerRecord extends ConsentFlags, CustomerAggregates {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  locale: Locale;
  birthday: string | null;
  tags: string[];
  allergies: string | null;
  preferences: string | null;
  notes: string | null;
  firstSeenAt: Date;
  lastActivityAt: Date | null;
  anonymizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function mapCustomer(row: Selectable<CustomersTable>): CustomerRecord {
  return {
    id: row.id,
    phone: row.phone,
    name: row.name,
    email: row.email,
    locale: parseLocale(row.locale),
    birthday: row.birthday,
    tags: row.tags ?? [],
    allergies: row.allergies,
    preferences: row.preferences,
    notes: row.notes,
    personalDataConsent: row.personal_data_consent,
    personalDataConsentVersion: row.personal_data_consent_version,
    personalDataConsentAt: row.personal_data_consent_at,
    marketingConsent: row.marketing_consent,
    marketingConsentVersion: row.marketing_consent_version,
    marketingConsentAt: row.marketing_consent_at,
    firstSeenAt: row.first_seen_at,
    lastActivityAt: row.last_activity_at,
    ordersCount: row.orders_count,
    completedOrdersCount: row.completed_orders_count,
    totalSpent: Money.of(Number(row.total_spent_amount), row.total_spent_currency.trim() as Currency),
    reservationsCount: row.reservations_count,
    noShowCount: row.no_show_count,
    banquetsCount: row.banquets_count,
    anonymizedAt: row.anonymized_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type CustomerSort = 'lastActivity' | 'totalSpent' | 'name' | 'firstSeen';

const SORT_COLUMNS: Record<CustomerSort, 'c.last_activity_at' | 'c.total_spent_amount' | 'c.name' | 'c.first_seen_at'> = {
  lastActivity: 'c.last_activity_at',
  totalSpent: 'c.total_spent_amount',
  name: 'c.name',
  firstSeen: 'c.first_seen_at',
};

type CustomerQuery = SelectQueryBuilder<CustomersTables & { c: CustomersTable }, 'c', object>;

@Injectable()
export class CustomerRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<CustomersTables>();
  }

  async findById(id: string): Promise<CustomerRecord | null> {
    const row = await this.db()
      .selectFrom('customers.customers')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? mapCustomer(row) : null;
  }

  /** С блокировкой строки до конца транзакции (агрегаты, согласия, обезличивание). */
  async findByIdForUpdate(id: string): Promise<CustomerRecord | null> {
    const row = await this.db()
      .selectFrom('customers.customers')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    return row ? mapCustomer(row) : null;
  }

  async findByPhone(phone: string): Promise<CustomerRecord | null> {
    const row = await this.db()
      .selectFrom('customers.customers')
      .selectAll()
      .where('phone', '=', phone)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? mapCustomer(row) : null;
  }

  /** Вставка, если телефона ещё нет (конкурентные вызовы не создают дубликат). Возвращает true, если вставлено. */
  async insertIfAbsent(input: {
    id: string;
    phone: string;
    name: string | null;
    email: string | null;
    locale: Locale;
    firstSeenAt: Date;
  }): Promise<boolean> {
    const row = await this.db()
      .insertInto('customers.customers')
      .values({
        id: input.id,
        phone: input.phone,
        name: input.name,
        email: input.email,
        locale: input.locale,
        birthday: null,
        tags: [],
        allergies: null,
        preferences: null,
        notes: null,
        personal_data_consent: false,
        personal_data_consent_version: null,
        personal_data_consent_at: null,
        marketing_consent: false,
        marketing_consent_version: null,
        marketing_consent_at: null,
        first_seen_at: input.firstSeenAt,
        last_activity_at: null,
        orders_count: 0,
        completed_orders_count: 0,
        total_spent_amount: 0,
        total_spent_currency: 'KZT',
        reservations_count: 0,
        no_show_count: 0,
        banquets_count: 0,
        anonymized_at: null,
        deleted_at: null,
      })
      .onConflict((oc) => oc.column('phone').where('deleted_at', 'is', null).doNothing())
      .returning('id')
      .executeTakeFirst();
    return !!row;
  }

  /** Заполнить только пустые поля (атомарно: данные менеджера не затираются даже при гонке). */
  async fillEmpty(id: string, patch: { name?: string | null; email?: string | null }): Promise<void> {
    const set: Record<string, unknown> = {};
    if (patch.name) set.name = sql`coalesce(nullif(name, ''), ${patch.name})`;
    if (patch.email) set.email = sql`coalesce(nullif(email, ''), ${patch.email})`;
    if (Object.keys(set).length === 0) return;
    await this.db().updateTable('customers.customers').set(set).where('id', '=', id).execute();
  }

  async updateProfile(id: string, profile: EditableProfile): Promise<void> {
    await this.db()
      .updateTable('customers.customers')
      .set({
        name: profile.name,
        email: profile.email,
        birthday: profile.birthday,
        locale: profile.locale,
        tags: profile.tags,
        allergies: profile.allergies,
        preferences: profile.preferences,
        notes: profile.notes,
      })
      .where('id', '=', id)
      .execute();
  }

  async updateConsentFlags(id: string, flags: ConsentFlags): Promise<void> {
    await this.db()
      .updateTable('customers.customers')
      .set({
        personal_data_consent: flags.personalDataConsent,
        personal_data_consent_version: flags.personalDataConsentVersion,
        personal_data_consent_at: flags.personalDataConsentAt,
        marketing_consent: flags.marketingConsent,
        marketing_consent_version: flags.marketingConsentVersion,
        marketing_consent_at: flags.marketingConsentAt,
      })
      .where('id', '=', id)
      .execute();
  }

  async updateAggregates(
    id: string,
    input: { aggregates: CustomerAggregates; tags: string[]; firstSeenAt: Date; lastActivityAt: Date | null },
  ): Promise<void> {
    const a = input.aggregates;
    await this.db()
      .updateTable('customers.customers')
      .set({
        orders_count: a.ordersCount,
        completed_orders_count: a.completedOrdersCount,
        total_spent_amount: a.totalSpent.amount,
        total_spent_currency: a.totalSpent.currency,
        reservations_count: a.reservationsCount,
        no_show_count: a.noShowCount,
        banquets_count: a.banquetsCount,
        tags: input.tags,
        first_seen_at: input.firstSeenAt,
        last_activity_at: input.lastActivityAt,
      })
      .where('id', '=', id)
      .execute();
  }

  /** Добавить тег, если его ещё нет (атомарно). */
  async addTag(id: string, tag: string): Promise<void> {
    await this.db()
      .updateTable('customers.customers')
      .set({ tags: sql`array_append(tags, ${tag}::text)` })
      .where('id', '=', id)
      .where(sql<boolean>`not (${tag}::text = any(tags))`)
      .execute();
  }

  /** Обезличивание: телефон -> маркер, ПД стираются, агрегаты и история сохраняются. */
  async anonymize(id: string, marker: string, at: Date): Promise<void> {
    await this.db()
      .updateTable('customers.customers')
      .set({
        phone: marker,
        name: null,
        email: null,
        birthday: null,
        allergies: null,
        preferences: null,
        notes: null,
        personal_data_consent: false,
        marketing_consent: false,
        anonymized_at: at,
      })
      .where('id', '=', id)
      .execute();
  }

  // ---------------------------------------------------------------- поиск и выгрузка

  private applyFilter(q: CustomerQuery, f: CustomerFilter, options: { includeAnonymized?: boolean } = {}): CustomerQuery {
    let query = q.where('c.deleted_at', 'is', null);
    if (!options.includeAnonymized) query = query.where('c.anonymized_at', 'is', null);
    if (f.q) {
      const like = `%${escapeLike(f.q.toLowerCase())}%`;
      const phonePatterns = phoneSearchPatterns(f.q);
      query = query.where((eb: ExpressionBuilder<CustomersTables & { c: CustomersTable }, 'c'>) =>
        eb.or([
          eb(eb.fn('lower', ['c.name']), 'like', like),
          eb('c.email', 'like', like),
          ...phonePatterns.map((pattern) => eb('c.phone', 'like', pattern)),
        ]),
      );
    }
    if (f.tags?.length) query = query.where(sql<boolean>`c.tags @> ${sql.val(f.tags)}::text[]`);
    if (f.spentMin !== undefined) query = query.where('c.total_spent_amount', '>=', f.spentMin);
    if (f.spentMax !== undefined) query = query.where('c.total_spent_amount', '<=', f.spentMax);
    if (f.lastActivityFrom) query = query.where('c.last_activity_at', '>=', startOfLocalDay(f.lastActivityFrom));
    if (f.lastActivityTo) query = query.where('c.last_activity_at', '<', startOfLocalDay(addDays(f.lastActivityTo, 1)));
    if (f.branchId) {
      const branchId = f.branchId;
      query = query.where(({ exists, selectFrom }) =>
        exists(
          selectFrom('customers.activities as a')
            .select(sql`1`.as('one'))
            .whereRef('a.customer_id', '=', 'c.id')
            .where('a.branch_id', '=', branchId),
        ),
      );
    }
    if (f.hasBanquet !== undefined) query = query.where('c.banquets_count', f.hasBanquet ? '>' : '=', 0);
    if (f.marketingConsent !== undefined) query = query.where('c.marketing_consent', '=', f.marketingConsent);
    return query;
  }

  private base(): CustomerQuery {
    return this.db().selectFrom('customers.customers as c') as unknown as CustomerQuery;
  }

  async search(
    filter: CustomerFilter,
    options: { sort: CustomerSort; order: 'asc' | 'desc'; includeAnonymized?: boolean },
    page: PageRequest,
  ): Promise<Page<CustomerRecord>> {
    const q = this.applyFilter(this.base(), filter, options);
    const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await q
      .selectAll('c')
      .orderBy(SORT_COLUMNS[options.sort], (ob) => (options.order === 'asc' ? ob.asc().nullsLast() : ob.desc().nullsLast()))
      .orderBy('c.id', 'desc')
      .limit(page.perPage)
      .offset(offsetOf(page))
      .execute();
    return pageOf(
      rows.map((r) => mapCustomer(r as Selectable<CustomersTable>)),
      Number(total?.n ?? 0),
      page,
    );
  }

  async count(filter: CustomerFilter): Promise<number> {
    const row = await this.applyFilter(this.base(), filter)
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  /** Строки выгрузки (обезличенные не выгружаются никогда). limit+1 — чтобы понять, что превышен лимит. */
  async listForExport(filter: CustomerFilter, limit: number): Promise<CustomerRecord[]> {
    const rows = await this.applyFilter(this.base(), filter, { includeAnonymized: false })
      .selectAll('c')
      .orderBy('c.first_seen_at')
      .orderBy('c.id')
      .limit(limit)
      .execute();
    return rows.map((r) => mapCustomer(r as Selectable<CustomersTable>));
  }

  /** Теги с числом гостей (для фильтров в админке). */
  async tagStats(): Promise<Array<{ tag: string; count: number }>> {
    const result = await sql<{ tag: string; count: number }>`
      select t.tag, count(*)::int as count
      from customers.customers c, unnest(c.tags) as t(tag)
      where c.deleted_at is null and c.anonymized_at is null
      group by t.tag
      order by count desc, t.tag`.execute(this.db());
    return result.rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
  }
}
