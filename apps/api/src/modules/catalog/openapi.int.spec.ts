import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpenAPIObject } from '@nestjs/swagger';
import { buildOpenApiDocument } from '../../shared/infrastructure/http/swagger';
import { TestApp } from '../../../test/support/test-app';
import { createCatalogTestApp } from './testing/catalog-test-kit';

type Operation = {
  tags?: string[];
  security?: Array<Record<string, unknown>>;
  responses: Record<string, { content?: Record<string, { schema?: Record<string, any> }> }>;
  requestBody?: { content: Record<string, unknown> };
};

/** Типизированный клиент строится по OpenAPI: все маршруты Catalog описаны, ответы — DTO. */
describe('Catalog OpenAPI (integration)', () => {
  let t: TestApp;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    ({ t } = await createCatalogTestApp());
    doc = buildOpenApiDocument(t.app, 'test');
  });
  afterAll(async () => t.close());

  const catalogOps = () =>
    Object.entries(doc.paths)
      .filter(([path]) => /\/(admin\/catalog|admin\/content|public\/catalog|public\/content)/.test(path))
      .flatMap(([path, item]) => Object.entries(item as Record<string, Operation>).map(([method, op]) => ({ path, method, op })));

  it('documents every endpoint group with tags, auth and described responses', () => {
    const ops = catalogOps();
    const paths = new Set(ops.map((o) => `${o.method.toUpperCase()} ${o.path}`));
    for (const expected of [
      'GET /api/v1/public/catalog/branches/{branchSlug}/menu',
      'GET /api/v1/public/catalog/branches/{branchSlug}/categories/{categorySlug}',
      'GET /api/v1/public/catalog/branches/{branchSlug}/dishes/{dishSlug}',
      'GET /api/v1/public/catalog/branches/{branchSlug}/search',
      'GET /api/v1/public/catalog/sitemap',
      'GET /api/v1/public/content/banners',
      'GET /api/v1/public/content/promotions',
      'GET /api/v1/public/content/pages/{slug}',
      'POST /api/v1/admin/catalog/categories',
      'PUT /api/v1/admin/catalog/categories/order',
      'POST /api/v1/admin/catalog/dishes/{id}/photos',
      'PUT /api/v1/admin/catalog/dishes/{id}/photos/order',
      'PUT /api/v1/admin/catalog/modifier-groups/{id}',
      'GET /api/v1/admin/catalog/branches/{branchId}/menu',
      'POST /api/v1/admin/catalog/branches/{branchId}/menu/bulk-prices',
      'POST /api/v1/admin/catalog/branches/{branchId}/menu/copy',
      'PUT /api/v1/admin/catalog/branches/{branchId}/menu/{dishId}/price',
      'PUT /api/v1/admin/catalog/branches/{branchId}/menu/{dishId}/availability',
      'GET /api/v1/admin/catalog/branches/{branchId}/stop-list',
      'GET /api/v1/admin/catalog/translations',
      'POST /api/v1/admin/content/banners/{id}/image',
      'DELETE /api/v1/admin/content/pages/{id}',
    ]) {
      expect(paths, expected).toContain(expected);
    }
    for (const { path, method, op } of ops) {
      const isAdmin = path.includes('/admin/');
      expect(op.tags, `${method} ${path}`).toEqual([isAdmin ? 'admin' : 'public']);
      if (isAdmin) expect(op.security, `${method} ${path}`).toEqual([{ staff: [] }]);
      const ok = Object.entries(op.responses).find(([code]) => code.startsWith('2'));
      expect(ok, `${method} ${path}`).toBeDefined();
      if (ok![0] !== '204') expect(ok![1].content?.['application/json']?.schema, `${method} ${path}`).toBeDefined();
    }
  });

  it('describes money, pages and uploads for the generated client', () => {
    const schemas = doc.components!.schemas as Record<string, any>;
    expect(schemas.DishesPageDto.properties.items.items.$ref).toBe('#/components/schemas/DishDto');
    expect(schemas.BranchMenuPageDto.properties.items.items.$ref).toBe('#/components/schemas/BranchMenuItemDto');
    expect(schemas.PublicDishPageDto.properties.items.items.$ref).toBe('#/components/schemas/PublicDishCardDto');
    expect(schemas.BranchMenuItemDto.properties.price.allOf?.[0]?.$ref ?? schemas.BranchMenuItemDto.properties.price.$ref).toBe(
      '#/components/schemas/MoneyDto',
    );
    expect(schemas.DishDto.properties).not.toHaveProperty('price');
    expect(schemas.PublicMenuDto.required).toEqual(expect.arrayContaining(['branch', 'categories', 'structuredData', 'restaurantStructuredData']));
    const upload = (doc.paths['/api/v1/admin/catalog/dishes/{id}/photos'] as Record<string, Operation>).post!;
    expect(Object.keys(upload.requestBody!.content)).toEqual(['multipart/form-data']);
    const search = (doc.paths['/api/v1/public/catalog/branches/{branchSlug}/search'] as Record<string, { parameters: Array<{ name: string }> }>).get!;
    expect(search.parameters.map((p) => p.name)).toEqual(
      expect.arrayContaining(['q', 'vegetarian', 'spicy', 'halal', 'maxPrice', 'category', 'page', 'perPage', 'locale']),
    );
  });
});
