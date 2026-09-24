import { Injectable } from '@nestjs/common';

/**
 * Каталог интеграций: каждый адаптер описывает свои поля настроек, админка строит по нему форму.
 * Адаптеры регистрируются в onModuleInit своего модуля: catalog.register({...}).
 */
export interface IntegrationField {
  name: string;
  label: string;
  type: 'string' | 'url' | 'number' | 'boolean' | 'select' | 'json';
  secret?: boolean;
  required?: boolean;
  options?: string[];
  help?: string;
}

export interface IntegrationDescriptor {
  /** '<модуль>.<провайдер>' */
  key: string;
  title: string;
  /** Назначение из ТЗ: оплата, уведомления, POS, логистика, учёт, ЭСФ, аналитика. */
  category: 'payments' | 'notifications' | 'pos' | 'delivery' | 'accounting' | 'esf' | 'geocoding' | 'analytics' | 'other';
  stage: 1 | 2 | 3;
  description: string;
  fields: IntegrationField[];
}

@Injectable()
export class IntegrationCatalog {
  private readonly items = new Map<string, IntegrationDescriptor>();

  register(descriptor: IntegrationDescriptor): void {
    this.items.set(descriptor.key, descriptor);
  }

  list(): IntegrationDescriptor[] {
    return [...this.items.values()].sort((a, b) => a.category.localeCompare(b.category) || a.key.localeCompare(b.key));
  }

  get(key: string): IntegrationDescriptor | undefined {
    return this.items.get(key);
  }
}
