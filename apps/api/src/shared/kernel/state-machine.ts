import { InvalidStateTransitionError } from './errors';

/**
 * Конечный автомат статусов. Переход разрешён только по схеме,
 * недопустимый переход бросает InvalidStateTransitionError.
 */
export type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

export class StateMachine<S extends string> {
  constructor(
    readonly name: string,
    private readonly transitions: TransitionMap<S>,
  ) {}

  canTransition(from: S, to: S): boolean {
    return (this.transitions[from] ?? []).includes(to);
  }

  assertTransition(from: S, to: S): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidStateTransitionError(this.name, from, to);
    }
  }

  allowedFrom(from: S): readonly S[] {
    return this.transitions[from] ?? [];
  }

  isFinal(state: S): boolean {
    return this.allowedFrom(state).length === 0;
  }

  states(): S[] {
    return Object.keys(this.transitions) as S[];
  }
}

/** Помощник для enum-подобных констант: OrderStatus.Paid и тип OrderStatus. */
export type EnumValue<T extends Record<string, string>> = T[keyof T];

export function enumValues<T extends Record<string, string>>(e: T): Array<EnumValue<T>> {
  return Object.values(e) as Array<EnumValue<T>>;
}

export function isEnumValue<T extends Record<string, string>>(e: T, value: unknown): value is EnumValue<T> {
  return typeof value === 'string' && (Object.values(e) as string[]).includes(value);
}
