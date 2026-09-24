import { StateMachine } from '../../../shared/kernel/state-machine';
import { NotificationChannel } from '../public';

/**
 * Доставка уведомления одному адресату по цепочке каналов с резервом (WhatsApp -> SMS).
 *
 * Правила:
 * - временный сбой канала (сеть, 5xx, лимиты) — повтор задачей с экспоненциальной задержкой,
 *   не больше MAX_ATTEMPTS_PER_CHANNEL попыток на канал, затем переход к следующему каналу;
 * - постоянная ошибка (неверный номер, шаблон не одобрен) или ненастроенный канал — сразу следующий канал;
 * - каналы закончились — доставка неуспешна (failed);
 * - провайдер может сообщить об ошибке уже после «отправлено» (статус WhatsApp) — тогда доставка
 *   переоткрывается на следующем канале цепочки.
 */
export const DeliveryStatus = {
  Pending: 'pending',
  Sent: 'sent',
  Failed: 'failed',
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];
export const DELIVERY_STATUSES = Object.values(DeliveryStatus);

export const DELIVERY_FSM = new StateMachine<DeliveryStatus>('notification_delivery', {
  pending: ['sent', 'failed'],
  sent: ['pending', 'failed'],
  failed: [],
});

/** Попыток на один канал, прежде чем перейти к резервному. */
export const MAX_ATTEMPTS_PER_CHANNEL = 3;

export interface DeliveryStep {
  channel: NotificationChannel;
  address: string;
}

export interface DeliveryState {
  status: DeliveryStatus;
  chain: DeliveryStep[];
  stepIndex: number;
  /** Все попытки отправки по доставке. */
  attempts: number;
  /** Неудачные попытки с временной ошибкой на текущем канале. */
  channelAttempts: number;
}

export type FailureKind = 'retryable' | 'permanent' | 'not_configured';
/** retry — повторить текущий канал позже; next — перейти к следующему каналу; exhausted — каналов больше нет. */
export type FailureDecision = 'retry' | 'next' | 'exhausted';

export class Delivery {
  private state: DeliveryState;

  constructor(state: DeliveryState) {
    if (state.chain.length === 0) throw new Error('Delivery chain must not be empty');
    this.state = { ...state, chain: [...state.chain] };
  }

  static start(chain: DeliveryStep[]): Delivery {
    return new Delivery({ status: DeliveryStatus.Pending, chain, stepIndex: 0, attempts: 0, channelAttempts: 0 });
  }

  snapshot(): DeliveryState {
    return { ...this.state, chain: [...this.state.chain] };
  }

  get status(): DeliveryStatus {
    return this.state.status;
  }

  get isPending(): boolean {
    return this.state.status === DeliveryStatus.Pending;
  }

  get current(): DeliveryStep {
    return this.state.chain[Math.min(this.state.stepIndex, this.state.chain.length - 1)]!;
  }

  get hasNextStep(): boolean {
    return this.state.stepIndex + 1 < this.state.chain.length;
  }

  /** Шаги цепочки, начиная с текущего. */
  remainingSteps(): DeliveryStep[] {
    return this.state.chain.slice(this.state.stepIndex);
  }

  /** Номер следующей попытки (для журнала попыток). */
  nextAttemptNo(): number {
    return this.state.attempts + 1;
  }

  markSent(): void {
    DELIVERY_FSM.assertTransition(this.state.status, DeliveryStatus.Sent);
    this.state.attempts += 1;
    this.state.status = DeliveryStatus.Sent;
  }

  /**
   * Неудачная попытка текущим каналом. allowRetry=false — повторов больше не будет
   * (исчерпан лимит запусков задачи), временная ошибка считается окончательной для канала.
   */
  registerFailure(kind: FailureKind, options: { allowRetry: boolean }): FailureDecision {
    if (!this.isPending) throw new Error(`Failure can be registered only for pending delivery, current status ${this.state.status}`);
    if (kind !== 'not_configured') this.state.attempts += 1;
    if (kind === 'retryable' && options.allowRetry) {
      const used = this.state.channelAttempts + 1;
      if (used < MAX_ATTEMPTS_PER_CHANNEL) {
        this.state.channelAttempts = used;
        return 'retry';
      }
    }
    return this.advance();
  }

  /** Окончательный провал (каналы исчерпаны, сообщение устарело). */
  fail(): void {
    DELIVERY_FSM.assertTransition(this.state.status, DeliveryStatus.Failed);
    this.state.status = DeliveryStatus.Failed;
  }

  /** Отправка другим каналом цепочки (служебный канал в тестовой среде): текущий шаг меняется на указанный. */
  moveTo(step: DeliveryStep): void {
    const index = this.state.chain.findIndex((s) => s.channel === step.channel && s.address === step.address);
    if (index === -1) throw new Error('Step is not part of the delivery chain');
    this.state.stepIndex = index;
    this.state.channelAttempts = 0;
  }

  /**
   * Провайдер сообщил об ошибке уже отправленного сообщения. Есть следующий канал — доставка
   * снова ожидает отправки им (next); нет — доставка неуспешна (exhausted).
   */
  reopenAfterAsyncFailure(): FailureDecision {
    if (this.state.status !== DeliveryStatus.Sent) {
      throw new Error(`Only sent delivery can be reopened, current status ${this.state.status}`);
    }
    if (!this.hasNextStep) {
      DELIVERY_FSM.assertTransition(this.state.status, DeliveryStatus.Failed);
      this.state.status = DeliveryStatus.Failed;
      return 'exhausted';
    }
    DELIVERY_FSM.assertTransition(this.state.status, DeliveryStatus.Pending);
    this.state.status = DeliveryStatus.Pending;
    this.state.stepIndex += 1;
    this.state.channelAttempts = 0;
    return 'next';
  }

  private advance(): FailureDecision {
    if (this.hasNextStep) {
      this.state.stepIndex += 1;
      this.state.channelAttempts = 0;
      return 'next';
    }
    return 'exhausted';
  }
}

// ---------------------------------------------------------------- сообщение

export const MessageStatus = {
  Queued: 'queued',
  Sent: 'sent',
  Partial: 'partial',
  Failed: 'failed',
  Skipped: 'skipped',
} as const;
export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];
export const MESSAGE_STATUSES = Object.values(MessageStatus);

/** Сообщение: queued -> итог по доставкам; отправленное может вернуться в очередь, если провайдер сообщил об ошибке. */
export const MESSAGE_FSM = new StateMachine<MessageStatus>('notification_message', {
  queued: ['sent', 'partial', 'failed', 'skipped'],
  sent: ['queued', 'partial', 'failed'],
  partial: ['queued', 'failed'],
  failed: [],
  skipped: [],
});

export function isFinalMessageStatus(status: MessageStatus): boolean {
  return status !== MessageStatus.Queued;
}

/** Итоговый статус сообщения по статусам доставок; null — есть незавершённые доставки. */
export function aggregateMessageStatus(statuses: readonly DeliveryStatus[]): MessageStatus | null {
  if (statuses.length === 0) return MessageStatus.Skipped;
  if (statuses.some((s) => s === DeliveryStatus.Pending)) return null;
  const sent = statuses.filter((s) => s === DeliveryStatus.Sent).length;
  if (sent === statuses.length) return MessageStatus.Sent;
  if (sent === 0) return MessageStatus.Failed;
  return MessageStatus.Partial;
}
