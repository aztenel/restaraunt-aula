import { Global, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Config } from '../config/config';
import { BullmqRuntime } from './bullmq-runtime';
import { EventBus, JobQueue } from './event-bus';
import { FailedJobsService } from './failed-jobs.service';
import { HandlerExecutor } from './handler-executor';
import { HandlerRegistry } from './handler-registry';
import { OutboxProcessor } from './outbox-processor';
import { OutboxSignal } from './outbox-signal';

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [EventBus, JobQueue, OutboxSignal, HandlerRegistry, HandlerExecutor, OutboxProcessor, FailedJobsService, BullmqRuntime],
  exports: [EventBus, JobQueue, OutboxSignal, HandlerRegistry, HandlerExecutor, OutboxProcessor, FailedJobsService, BullmqRuntime],
})
export class EventsModule implements OnApplicationBootstrap {
  private readonly logger = new Logger('EventsModule');

  constructor(
    private readonly config: Config,
    private readonly signal: OutboxSignal,
    private readonly processor: OutboxProcessor,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.queue.driver === 'inline' && this.config.queue.inlineAutoDrain) {
      let scheduled = false;
      this.signal.subscribe(() => {
        if (scheduled) return;
        scheduled = true;
        setTimeout(() => {
          scheduled = false;
          this.processor.drain().catch((err) => this.logger.error({ err }, 'Inline outbox drain failed'));
        }, 10);
      });
    }
  }
}
