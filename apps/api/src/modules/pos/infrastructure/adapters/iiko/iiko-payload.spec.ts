import { describe, expect, it } from 'vitest';
import { KitchenOrder } from '../../../../ordering/public';
import {
  buildDeliveryRequest,
  buildOrderComment,
  formatIikoDateTime,
  iikoErrorMessage,
  parseCreateDeliveryResponse,
  parseNomenclature,
  parseStopLists,
} from './iiko-payload';

const order: KitchenOrder = {
  orderId: '0191f000-0000-7000-8000-00000000000a',
  number: 'GL-2026-000042',
  branchId: 'b1',
  type: 'delivery',
  status: 'accepted',
  items: [],
  comment: ' Без лука ',
  scheduledFor: '2026-10-01T14:30:00.000Z',
  customer: { name: null, phone: '+77011234567' },
  deliveryAddress: 'ул. Сарайшык, 5, кв. 10',
  total: { amount: 1_250_050, currency: 'KZT' },
  paymentMethod: 'on_receipt',
  isPaidOnline: false,
  placedAt: '2026-10-01T12:00:00.000Z',
};

const mapping = {
  timezone: 'Asia/Almaty',
  lines: [
    {
      dishId: 'd1',
      externalProductId: 'P-1',
      quantity: 2,
      name: 'Плов',
      modifiers: [{ optionId: 'o1', externalProductId: 'M-1', externalGroupId: 'G-1', amount: 1 }],
    },
    { dishId: 'd2', externalProductId: 'P-2', quantity: 1, name: 'Лагман', modifiers: [{ optionId: 'o2', externalProductId: 'M-2', externalGroupId: null, amount: 2 }] },
  ],
};

describe('iiko payload', () => {
  it('builds deliveries/create for a courier delivery', () => {
    const req = buildDeliveryRequest(order, mapping, { organizationId: 'ORG', terminalGroupId: 'TG' });
    expect(req.organizationId).toBe('ORG');
    expect(req.terminalGroupId).toBe('TG');
    expect(req.order.id).toBe(order.orderId);
    expect(req.order.externalNumber).toBe('GL-2026-000042');
    expect(req.order.phone).toBe('+77011234567');
    expect(req.order.orderServiceType).toBe('DeliveryByCourier');
    expect(req.order.deliveryPoint).toEqual({ comment: 'ул. Сарайшык, 5, кв. 10' });
    expect(req.order.customer).toEqual({ name: 'Гость' });
    expect(req.order.completeBefore).toMatch(/^2026-10-01 \d{2}:30:00\.000$/);
    expect(req.order.items).toEqual([
      { productId: 'P-1', amount: 2, type: 'Product', modifiers: [{ productId: 'M-1', amount: 1, productGroupId: 'G-1' }] },
      { productId: 'P-2', amount: 1, type: 'Product', modifiers: [{ productId: 'M-2', amount: 2 }] },
    ]);
  });

  it('pickup has no delivery point, no completeBefore when ASAP, no terminal group when not configured', () => {
    const req = buildDeliveryRequest(
      { ...order, type: 'pickup', scheduledFor: null, deliveryAddress: null, customer: { name: ' Айгерим ', phone: '+77011234567' } },
      mapping,
      { organizationId: 'ORG' },
    );
    expect(req.order.orderServiceType).toBe('DeliveryByClient');
    expect(req.order).not.toHaveProperty('deliveryPoint');
    expect(req.order).not.toHaveProperty('completeBefore');
    expect(req).not.toHaveProperty('terminalGroupId');
    expect(req.order.customer.name).toBe('Айгерим');
  });

  it('formats local time of the branch', () => {
    const utc = '2026-10-01T14:30:05.000Z';
    expect(formatIikoDateTime(utc, 'UTC')).toBe('2026-10-01 14:30:05.000');
  });

  it('comment tells the kitchen about payment, address and guest wishes', () => {
    expect(buildOrderComment(order)).toBe(
      'Заказ GL-2026-000042 (сайт)\nОплата при получении: 12500.50 KZT\nАдрес: ул. Сарайшык, 5, кв. 10\nКомментарий гостя: Без лука',
    );
    expect(buildOrderComment({ ...order, isPaidOnline: true, comment: null, type: 'pickup' })).toBe('Заказ GL-2026-000042 (сайт)\nОплачен онлайн');
  });

  it('parses create response and errors', () => {
    expect(parseCreateDeliveryResponse({ orderInfo: { id: 'X', creationStatus: 'InProgress' } })).toEqual({
      posOrderId: 'X',
      creationStatus: 'InProgress',
      error: null,
    });
    expect(parseCreateDeliveryResponse({ orderInfo: { id: 'X', creationStatus: 'Error', errorInfo: { code: 'Common', message: 'Product not found' } } }).error).toBe(
      'Product not found',
    );
    expect(parseCreateDeliveryResponse('garbage').posOrderId).toBeNull();
    expect(iikoErrorMessage({ errorDescription: 'Organization not found' })).toBe('Organization not found');
    expect(iikoErrorMessage('')).toBeNull();
  });

  it('parses stop lists of the branch organization and terminal group', () => {
    const body = {
      terminalGroupStopLists: [
        {
          organizationId: 'ORG',
          items: [
            { terminalGroupId: 'TG', items: [{ productId: 'P-1', balance: 0 }, { productId: 'P-2', balance: 3 }] },
            { terminalGroupId: 'OTHER', items: [{ productId: 'P-3', balance: 0 }] },
          ],
        },
        { organizationId: 'ORG-2', items: [{ terminalGroupId: 'TG', items: [{ productId: 'P-4', balance: 0 }] }] },
      ],
    };
    expect(parseStopLists(body, { organizationId: 'ORG', terminalGroupId: 'TG' })).toEqual([
      { externalProductId: 'P-1', available: false },
      { externalProductId: 'P-2', available: true },
    ]);
    expect(parseStopLists(body, { organizationId: 'ORG' }).map((i) => i.externalProductId)).toEqual(['P-1', 'P-2', 'P-3']);
    expect(parseStopLists(null, { organizationId: 'ORG' })).toEqual([]);
  });

  it('parses nomenclature without deleted products', () => {
    const products = parseNomenclature({
      groups: [{ id: 'G1', name: 'Горячее' }],
      products: [
        { id: 'P-1', name: ' Плов ', code: '00012', type: 'Dish', parentGroup: 'G1', isDeleted: false },
        { id: 'P-2', name: 'Сыр', code: '', type: 'Modifier', isDeleted: false },
        { id: 'P-3', name: 'Старое', type: 'Dish', isDeleted: true },
        { id: 'P-4', name: 'Набор', type: 'Unknown' },
      ],
    });
    expect(products).toEqual([
      { externalProductId: 'P-1', name: 'Плов', sku: '00012', kind: 'dish', groupName: 'Горячее' },
      { externalProductId: 'P-2', name: 'Сыр', sku: null, kind: 'modifier', groupName: null },
      { externalProductId: 'P-4', name: 'Набор', sku: null, kind: 'other', groupName: null },
    ]);
  });
});
