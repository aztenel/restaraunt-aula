import { Injectable } from '@nestjs/common';
import { KitchenOrder } from '../../../../ordering/public';
import { PosCapabilities, PosClient, PosProduct, PosPushResult, PosStopListItem } from '../../../domain/pos-client';

/**
 * «Ручной» режим (по умолчанию): внешней кассовой системы с API нет, кухня работает по экрану
 * заказов в админке. Передача заказа — пустая операция, стоп-лист ведётся в админке вручную.
 */
@Injectable()
export class ManualPosClient extends PosClient {
  readonly provider = 'manual';
  readonly capabilities: PosCapabilities = { pushOrders: false, stopList: false, nomenclature: false };

  async isConfigured(): Promise<boolean> {
    return true;
  }

  async pushOrder(_order: KitchenOrder): Promise<PosPushResult> {
    return { posOrderId: 'manual' };
  }

  async fetchStopList(): Promise<PosStopListItem[]> {
    return [];
  }

  async fetchProducts(): Promise<PosProduct[]> {
    return [];
  }
}
