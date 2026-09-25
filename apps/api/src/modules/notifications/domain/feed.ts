import { Actor } from '../../../shared/kernel/actor';
import { ValidationError } from '../../../shared/kernel/errors';
import { Permission } from '../../../shared/kernel/permissions';
import { AdminFeedEntityType, AdminFeedEvent, AdminFeedStream } from '../public';

/**
 * Лента событий админки: очереди новых заказов, броней, банкетных заявок (со звуком о новом)
 * и системные оповещения. Каждый поток виден только сотрудникам с правом просмотра в филиале события.
 */
export const FEED_STREAMS: readonly AdminFeedStream[] = ['orders', 'reservations', 'banquets', 'system'];
export const FEED_KINDS: ReadonlyArray<AdminFeedEvent['kind']> = ['created', 'updated'];
export const FEED_ENTITY_TYPES: readonly AdminFeedEntityType[] = ['order', 'reservation', 'banquet_request', 'failed_job', 'branch', 'dish'];

/** Тип сущности по умолчанию для потока (события без явного entityType, в т.ч. старые записи). */
export const DEFAULT_FEED_ENTITY_TYPES: Readonly<Record<AdminFeedStream, AdminFeedEntityType | null>> = {
  orders: 'order',
  reservations: 'reservation',
  banquets: 'banquet_request',
  system: null,
};

export const FEED_STREAM_PERMISSIONS: Readonly<Record<AdminFeedStream, Permission>> = {
  orders: Permission.OrdersView,
  reservations: Permission.ReservationsView,
  banquets: Permission.BanquetsView,
  system: Permission.SystemJobs,
};

export const FEED_PERMISSIONS: readonly Permission[] = Object.values(FEED_STREAM_PERMISSIONS);

/** Пинг SSE-соединения (держит соединение через прокси и позволяет клиенту заметить обрыв). */
export const FEED_PING_INTERVAL_MS = 25_000;
/** Срок жизни билета на подключение к потоку. */
export const FEED_TICKET_TTL_SECONDS = 60;
/** Поток закрывается сервером раз в 30 минут: клиент переподключается с новым билетом (актуальные права). */
export const FEED_STREAM_MAX_LIFETIME_MS = 30 * 60_000;
/** Сколько хранится история ленты. */
export const FEED_RETENTION_DAYS = 7;
export const FEED_TITLE_MAX_LENGTH = 300;

/** Элемент ленты: событие + идентификатор и время (для догрузки после переподключения). */
export interface FeedItem extends AdminFeedEvent {
  id: string;
  occurredAt: string;
  sound: boolean;
}

/** Видит ли сотрудник событие: право потока в филиале события (событие без филиала — глобальное право). */
export function canSeeFeedEvent(actor: Actor, event: Pick<AdminFeedEvent, 'stream' | 'branchId'>): boolean {
  const permission = FEED_STREAM_PERMISSIONS[event.stream];
  if (!permission) return false;
  return actor.can(permission, event.branchId);
}

/** Потоки, доступные сотруднику хотя бы в одном филиале. */
export function visibleStreams(actor: Actor): AdminFeedStream[] {
  return FEED_STREAMS.filter((s) => actor.canSomewhere(FEED_STREAM_PERMISSIONS[s]));
}

/** Проверка и нормализация события от модулей: поток и вид — из перечня, заголовок обрезается, звук по умолчанию для нового. */
export function normalizeFeedEvent(event: AdminFeedEvent): AdminFeedEvent & { sound: boolean; entityType: AdminFeedEntityType | null } {
  if (!FEED_STREAMS.includes(event.stream)) {
    throw new ValidationError('admin_feed.invalid_stream', `Unknown feed stream ${String(event.stream)}`);
  }
  if (!FEED_KINDS.includes(event.kind)) {
    throw new ValidationError('admin_feed.invalid_kind', `Unknown feed kind ${String(event.kind)}`);
  }
  const entityId = String(event.entityId ?? '').trim();
  if (!entityId) throw new ValidationError('admin_feed.entity_required', 'Feed event must reference an entity');
  const title = String(event.title ?? '').trim().slice(0, FEED_TITLE_MAX_LENGTH);
  if (event.entityType && !FEED_ENTITY_TYPES.includes(event.entityType)) {
    throw new ValidationError('admin_feed.invalid_entity_type', `Unknown feed entity type ${String(event.entityType)}`);
  }
  return {
    branchId: event.branchId ?? null,
    stream: event.stream,
    kind: event.kind,
    entityId,
    entityType: event.entityType ?? DEFAULT_FEED_ENTITY_TYPES[event.stream],
    title,
    sound: event.sound ?? event.kind === 'created',
  };
}

// ---------------------------------------------------------------- билет SSE

/**
 * Билет на подключение к потоку SSE: EventSource не умеет передавать заголовок Authorization,
 * поэтому сотрудник сначала получает короткоживущий подписанный билет (POST с JWT), затем открывает
 * поток с билетом в строке запроса. В билете — пользователь, срок и права, нужные для фильтрации ленты.
 */
export interface FeedTicketClaims {
  userId: string;
  name: string;
  /** Unix-время окончания действия, секунды. */
  expiresAt: number;
  global: Permission[];
  byBranch: Record<string, Permission[]>;
}

const PERMISSION_CODES: Record<string, string> = {
  [Permission.OrdersView]: 'o',
  [Permission.ReservationsView]: 'r',
  [Permission.BanquetsView]: 'b',
  [Permission.SystemJobs]: 's',
};
const CODE_PERMISSIONS: Record<string, Permission> = Object.fromEntries(
  Object.entries(PERMISSION_CODES).map(([p, c]) => [c, p as Permission]),
);

function encodePerms(perms: readonly Permission[]): string {
  return [...new Set(perms.map((p) => PERMISSION_CODES[p]).filter(Boolean))].sort().join('');
}

function decodePerms(codes: unknown): Permission[] {
  if (typeof codes !== 'string') return [];
  return [...codes].map((c) => CODE_PERMISSIONS[c]).filter((p): p is Permission => !!p);
}

/** Права актора, относящиеся к ленте (остальные в билет не попадают). */
export function feedClaimsFor(actor: Actor, expiresAt: number): FeedTicketClaims {
  const snapshot = actor.snapshot;
  const relevant = (perms: readonly Permission[]) => perms.filter((p) => FEED_PERMISSIONS.includes(p));
  const byBranch: Record<string, Permission[]> = {};
  for (const [branchId, perms] of Object.entries(snapshot.branchPermissions)) {
    const filtered = relevant(perms);
    if (filtered.length > 0) byBranch[branchId] = filtered;
  }
  return { userId: snapshot.userId ?? '', name: snapshot.name, expiresAt, global: relevant(snapshot.globalPermissions), byBranch };
}

export function actorFromFeedClaims(claims: FeedTicketClaims): Actor {
  return new Actor({
    kind: 'staff',
    userId: claims.userId,
    name: claims.name,
    globalPermissions: claims.global,
    branchPermissions: claims.byBranch,
  });
}

const TICKET_VERSION = 'f1';

/** Билет: f1.<base64url(json)>.<подпись>. sign — HMAC ключом приложения. */
export function encodeFeedTicket(claims: FeedTicketClaims, sign: (payload: string) => string): string {
  const body = {
    u: claims.userId,
    n: claims.name.slice(0, 80),
    e: claims.expiresAt,
    g: encodePerms(claims.global),
    b: Object.fromEntries(Object.entries(claims.byBranch).map(([branchId, perms]) => [branchId, encodePerms(perms)])),
  };
  const payload = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return `${TICKET_VERSION}.${payload}.${sign(`${TICKET_VERSION}.${payload}`)}`;
}

/** null — билет поддельный, повреждён или просрочен. */
export function decodeFeedTicket(
  ticket: string,
  verify: (payload: string, signature: string) => boolean,
  nowSeconds: number,
): FeedTicketClaims | null {
  const parts = (ticket ?? '').split('.');
  if (parts.length !== 3 || parts[0] !== TICKET_VERSION || !parts[1] || !parts[2]) return null;
  if (!verify(`${parts[0]}.${parts[1]}`, parts[2])) return null;
  let body: { u?: unknown; n?: unknown; e?: unknown; g?: unknown; b?: unknown };
  try {
    body = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as typeof body;
  } catch {
    return null;
  }
  if (typeof body.u !== 'string' || !body.u || typeof body.e !== 'number') return null;
  if (body.e < nowSeconds) return null;
  const byBranch: Record<string, Permission[]> = {};
  if (body.b && typeof body.b === 'object') {
    for (const [branchId, codes] of Object.entries(body.b as Record<string, unknown>)) {
      const perms = decodePerms(codes);
      if (perms.length > 0) byBranch[branchId] = perms;
    }
  }
  return {
    userId: body.u,
    name: typeof body.n === 'string' ? body.n : '',
    expiresAt: body.e,
    global: decodePerms(body.g),
    byBranch,
  };
}
