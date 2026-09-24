import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { createTestApp, TestApp } from '../../../../test/support/test-app';
import { createBranch, tokenFor } from '../../../../test/support/fixtures';
import { createFakes, Fakes, fakeProviders } from '../../../../test/fakes';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { OnEvent } from '../../../shared/infrastructure/events/decorators';
import { EventEnvelope } from '../../../shared/infrastructure/events/types';
import { pageRequest } from '../../../shared/kernel/pagination';
import { BranchSettings } from '../../identity/public';
import { CatalogModule } from '../catalog.module';
import { CatalogEvents, MenuPricing, MenuQuery, StopListControl } from '../public';

/**
 * Подписчик на события Catalog в тестах: события проходят настоящий путь outbox -> доставка
 * (t.drain()), так проверяется, что они публикуются в транзакции и доходят до подписчиков.
 */
@Injectable()
export class CatalogEventRecorder {
  readonly events: Array<{ id: string; type: string; payload: unknown }> = [];

  @OnEvent(CatalogEvents.MenuChanged, CatalogEvents.StopListChanged, CatalogEvents.ContentChanged)
  async record(event: EventEnvelope): Promise<void> {
    this.events.push({ id: event.id, type: event.type, payload: event.payload });
  }

  clear(): void {
    this.events.length = 0;
  }
}

/** Тестовое приложение: Identity + Catalog по-настоящему, остальные модули — заглушки. */
export async function createCatalogTestApp(): Promise<{ t: TestApp; fakes: Fakes }> {
  const fakes = createFakes();
  const t = await createTestApp({
    imports: [CatalogModule],
    migrateModules: ['catalog'],
    providers: [...fakeProviders(fakes, { except: [MenuPricing, MenuQuery, StopListControl] }), CatalogEventRecorder],
  });
  return { t, fakes };
}

/** Очистка БД между тестами + сброс записанных событий. */
export async function resetCatalogTest(t: TestApp): Promise<void> {
  await t.reset();
  t.get(CatalogEventRecorder).clear();
}

export const API = '/api/v1';

export interface Staff {
  auth: string;
  userId: string;
}

export async function contentManager(t: TestApp): Promise<Staff> {
  return tokenFor(t, [{ role: 'content_manager' }], 'Контент-менеджер');
}

export async function owner(t: TestApp): Promise<Staff> {
  return tokenFor(t, [{ role: 'owner' }], 'Собственник');
}

export async function branchManager(t: TestApp, branchId: string): Promise<Staff> {
  return tokenFor(t, [{ role: 'branch_manager', branchId }], 'Управляющий');
}

export async function operator(t: TestApp, branchId: string): Promise<Staff> {
  return tokenFor(t, [{ role: 'branch_operator', branchId }], 'Оператор');
}

export async function branch(t: TestApp, slug: string, settings: Partial<BranchSettings> = {}, isActive = true): Promise<string> {
  return createBranch(t, { code: slug.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase(), slug, settings, isActive });
}

/** Минимальное меню: категория, группа модификаторов, блюдо. Возвращает id. */
export async function createCategory(t: TestApp, auth: string, body: Record<string, unknown> = {}): Promise<string> {
  const res = await t
    .http()
    .post(`${API}/admin/catalog/categories`)
    .set('authorization', auth)
    .send({ name: { ru: 'Горячие блюда', kk: 'Ыстық тағамдар' }, ...body });
  if (res.status !== 201) throw new Error(`createCategory: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id;
}

export async function createGroup(t: TestApp, auth: string, body: Record<string, unknown> = {}): Promise<{ id: string; options: Array<{ id: string }> }> {
  const res = await t
    .http()
    .post(`${API}/admin/catalog/modifier-groups`)
    .set('authorization', auth)
    .send({
      name: { ru: 'Размер порции', kk: 'Порция көлемі' },
      minSelect: 1,
      maxSelect: 1,
      options: [
        { name: { ru: 'Стандартная', kk: 'Стандартты' }, price: { amount: 0 }, isDefault: true },
        { name: { ru: 'Большая', kk: 'Үлкен' }, price: { amount: 190_000 } },
      ],
      ...body,
    });
  if (res.status !== 201) throw new Error(`createGroup: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function createDish(t: TestApp, auth: string, categoryId: string, body: Record<string, unknown> = {}): Promise<string> {
  const res = await t
    .http()
    .post(`${API}/admin/catalog/dishes`)
    .set('authorization', auth)
    .send({
      categoryId,
      name: { ru: 'Бешбармак', kk: 'Бешбармақ' },
      composition: { ru: 'Конина, баранина, тесто, лук', kk: 'Жылқы еті, қой еті, қамыр, пияз' },
      weightGrams: 500,
      ...body,
    });
  if (res.status !== 201) throw new Error(`createDish: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id;
}

export async function addToMenu(t: TestApp, auth: string, branchId: string, dishId: string, amount: number, sku?: string): Promise<void> {
  const res = await t
    .http()
    .post(`${API}/admin/catalog/branches/${branchId}/menu`)
    .set('authorization', auth)
    .send({ dishId, price: { amount }, ...(sku ? { sku } : {}) });
  if (res.status !== 201) throw new Error(`addToMenu: ${res.status} ${JSON.stringify(res.body)}`);
}

export async function setAvailability(t: TestApp, auth: string, branchId: string, dishId: string, body: Record<string, unknown>) {
  return t.http().put(`${API}/admin/catalog/branches/${branchId}/menu/${dishId}/availability`).set('authorization', auth).send(body);
}

/** Тестовое изображение (PNG нужного размера). */
export async function testImage(width = 800, height = 600, color = '#c0392b'): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer();
}

export interface AuditRow {
  action: string;
  entity_type: string;
  entity_id: string;
  branch_id: string | null;
  actor_kind: string;
  actor_user_id: string | null;
  before: any;
  after: any;
  meta: any;
}

/** Записи журнала действий (через AuditLog.search) в порядке записи. */
export async function auditRows(t: TestApp, action: string): Promise<AuditRow[]> {
  const page = await t.get(AuditLog).search({ action }, pageRequest(1, 200));
  return page.items
    .filter((r) => r.action === action)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => ({
      action: r.action,
      entity_type: r.entityType,
      entity_id: r.entityId,
      branch_id: r.branchId,
      actor_kind: r.actorKind,
      actor_user_id: r.actorUserId,
      before: r.before,
      after: r.after,
      meta: r.meta,
    }));
}

/** Payload опубликованных событий (доставляются подписчику через outbox) в порядке публикации. */
export async function publishedEvents<T = any>(t: TestApp, type: string): Promise<T[]> {
  await t.drain();
  return t
    .get(CatalogEventRecorder)
    .events.filter((e) => e.type === type)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => e.payload as T);
}
