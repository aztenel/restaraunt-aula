import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Kysely, sql, Transaction } from 'kysely';

export const KYSELY = Symbol('KYSELY');

type IsolationLevel = 'read committed' | 'repeatable read' | 'serializable';

interface TxStore {
  trx: Transaction<any>;
  afterCommit: Array<() => void | Promise<void>>;
}

const txStorage = new AsyncLocalStorage<TxStore>();

/**
 * Доступ к БД с распространением транзакции через AsyncLocalStorage.
 * Внутри database.transaction(...) любой вызов db() — в том числе из публичного сервиса
 * другого модуля, журнала аудита или outbox — идёт в ту же транзакцию.
 *
 * Модуль типизирует db<ModuleTables>() своим интерфейсом таблиц и не видит чужие таблицы.
 */
@Injectable()
export class Database {
  private readonly logger = new Logger(Database.name);

  constructor(@Inject(KYSELY) private readonly root: Kysely<any>) {}

  db<T = any>(): Kysely<T> {
    const store = txStorage.getStore();
    return (store?.trx ?? this.root) as unknown as Kysely<T>;
  }

  inTransaction(): boolean {
    return txStorage.getStore() !== undefined;
  }

  /**
   * Выполнить fn в транзакции. Вложенный вызов присоединяется к внешней транзакции.
   * Колбэки afterCommit выполняются только после успешного COMMIT.
   */
  async transaction<T>(fn: () => Promise<T>, options: { isolation?: IsolationLevel } = {}): Promise<T> {
    if (this.inTransaction()) {
      return fn();
    }
    const store: Omit<TxStore, 'trx'> & { trx?: Transaction<any> } = { afterCommit: [] };
    let builder = this.root.transaction();
    if (options.isolation) {
      builder = builder.setIsolationLevel(options.isolation);
    }
    const result = await builder.execute(async (trx) => {
      store.trx = trx;
      return txStorage.run(store as TxStore, fn);
    });
    for (const cb of store.afterCommit) {
      try {
        await cb();
      } catch (err) {
        this.logger.error({ err }, 'afterCommit callback failed');
      }
    }
    return result;
  }

  /** Выполнить после коммита текущей транзакции (или сразу, если транзакции нет). */
  afterCommit(cb: () => void | Promise<void>): void {
    const store = txStorage.getStore();
    if (store) {
      store.afterCommit.push(cb);
    } else {
      void Promise.resolve()
        .then(cb)
        .catch((err) => this.logger.error({ err }, 'afterCommit callback failed'));
    }
  }

  /**
   * Транзакционная advisory-блокировка на ключ (снимается в конце транзакции).
   * Используется для сериализации конкурентных операций над одним объектом.
   */
  async advisoryLock(namespace: string, key: string): Promise<void> {
    if (!this.inTransaction()) {
      throw new Error('advisoryLock must be called inside a transaction');
    }
    await sql`select pg_advisory_xact_lock(hashtext(${namespace}), hashtext(${key}))`.execute(this.db());
  }

  /** Корневой Kysely — только для инфраструктуры (миграции, health-check). */
  rootConnection(): Kysely<any> {
    return this.root;
  }
}
