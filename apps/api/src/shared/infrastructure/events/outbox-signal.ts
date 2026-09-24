import { Injectable } from '@nestjs/common';

/**
 * Сигнал «в outbox появились записи». В inline-режиме (dev) по нему запускается обработка
 * в том же процессе; в режиме bullmq relay просыпается от pg NOTIFY и сигнал не нужен.
 */
@Injectable()
export class OutboxSignal {
  private listeners: Array<() => void> = [];

  subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  notify(): void {
    for (const l of this.listeners) l();
  }
}
