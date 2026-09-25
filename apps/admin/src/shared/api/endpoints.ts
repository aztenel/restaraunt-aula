/**
 * Типизированные обёртки над эндпоинтами Identity/System. Возвращают данные или бросают ApiError.
 *
 * Приведение типов (as unknown as ...) — из-за неточностей docs/openapi.json: nullable-поля
 * описаны без `type` (openapi-typescript выводит Record<string, never>). Реальные формы —
 * в @aula/api-client/types. После исправления DTO на бэкенде приведения можно убрать.
 */
import {
  call,
  type AuditRecord,
  type Branch,
  type BranchInput,
  type FailedJob,
  type IntegrationDescriptor,
  type IntegrationLogRecord,
  type IntegrationSetting,
  type LegalEntity,
  type LegalEntityInput,
  type Me,
  type Page,
  type RoleAssignment,
  type RoleDefinition,
  type SaveIntegrationSetting,
  type Schemas,
  type Session,
  type StaffUser,
} from '@aula/api-client';
import type { FeedTicket } from '../feed/types';
import { API_BASE_URL, api } from './client';

/** Числа и пустые значения → строки параметров запроса (бэкенд принимает строки). */
function query<T extends Record<string, string | number | boolean | null | undefined>>(params: T): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    result[key] = String(value);
  }
  return result;
}

function body<T>(value: unknown): T {
  return value as T;
}

export const authApi = {
  login: async (input: { email: string; password: string }) =>
    (await call(api.POST('/api/v1/admin/auth/login', { body: input }))) as Session,
  logout: () => call(api.POST('/api/v1/admin/auth/logout')),
  me: async () => (await call(api.GET('/api/v1/admin/auth/me'))) as unknown as Me,
  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    call(api.POST('/api/v1/admin/auth/change-password', { body: input })),
};

export interface UsersQuery {
  q?: string;
  role?: string;
  branchId?: string;
  page?: number;
  perPage?: number;
}

export interface CreateUserInput {
  email: string;
  name: string;
  phone?: string | null;
  telegramChatId?: string | null;
  password?: string;
  roles: RoleAssignment[];
}

export interface UpdateUserInput {
  email?: string;
  name?: string;
  phone?: string | null;
  telegramChatId?: string | null;
  isActive?: boolean;
}

export const usersApi = {
  list: async (params: UsersQuery) =>
    (await call(api.GET('/api/v1/admin/users', { params: { query: query({ ...params }) } }))) as unknown as Page<StaffUser>,
  roles: async () => (await call(api.GET('/api/v1/admin/users/roles'))) as unknown as RoleDefinition[],
  get: async (id: string) =>
    (await call(api.GET('/api/v1/admin/users/{id}', { params: { path: { id } } }))) as unknown as StaffUser,
  create: async (input: CreateUserInput) =>
    (await call(api.POST('/api/v1/admin/users', { body: body<Schemas['CreateUserDto']>(input) }))) as unknown as {
      user: StaffUser;
      temporaryPassword: string | null;
    },
  update: async (id: string, patch: UpdateUserInput) =>
    (await call(
      api.PATCH('/api/v1/admin/users/{id}', { params: { path: { id } }, body: body<Schemas['UpdateUserDto']>(patch) }),
    )) as unknown as StaffUser,
  setRoles: async (id: string, roles: RoleAssignment[]) =>
    (await call(
      api.PUT('/api/v1/admin/users/{id}/roles', { params: { path: { id } }, body: body<Schemas['SetRolesDto']>({ roles }) }),
    )) as unknown as StaffUser,
  resetPassword: async (id: string) =>
    (await call(api.POST('/api/v1/admin/users/{id}/reset-password', { params: { path: { id } } }))) as {
      temporaryPassword: string;
    },
};

export const branchesApi = {
  list: async () => (await call(api.GET('/api/v1/admin/branches'))) as unknown as Branch[],
  get: async (id: string) =>
    (await call(api.GET('/api/v1/admin/branches/{id}', { params: { path: { id } } }))) as unknown as Branch,
  create: async (input: BranchInput) =>
    (await call(api.POST('/api/v1/admin/branches', { body: body<Schemas['BranchInputDto']>(input) }))) as unknown as Branch,
  update: async (id: string, input: BranchInput) =>
    (await call(
      api.PUT('/api/v1/admin/branches/{id}', { params: { path: { id } }, body: body<Schemas['BranchInputDto']>(input) }),
    )) as unknown as Branch,
};

export const legalEntitiesApi = {
  list: async () => (await call(api.GET('/api/v1/admin/legal-entities'))) as unknown as LegalEntity[],
  create: async (input: LegalEntityInput) =>
    (await call(
      api.POST('/api/v1/admin/legal-entities', { body: body<Schemas['LegalEntityInputDto']>(input) }),
    )) as unknown as LegalEntity,
  update: async (id: string, input: LegalEntityInput) =>
    (await call(
      api.PUT('/api/v1/admin/legal-entities/{id}', {
        params: { path: { id } },
        body: body<Schemas['LegalEntityInputDto']>(input),
      }),
    )) as unknown as LegalEntity,
};

export interface AuditQuery {
  actorUserId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  branchId?: string;
  /** ISO 8601 */
  from?: string;
  to?: string;
  page?: number;
  perPage?: number;
}

export interface IntegrationLogsQuery {
  integration?: string;
  correlationId?: string;
  success?: 'true' | 'false';
  page?: number;
}

export const systemApi = {
  auditLog: async (params: AuditQuery) =>
    (await call(api.GET('/api/v1/admin/system/audit-log', { params: { query: query({ ...params }) } }))) as unknown as Page<AuditRecord>,
  integrationCatalog: async () =>
    (await call(api.GET('/api/v1/admin/system/integrations/catalog'))) as unknown as IntegrationDescriptor[],
  integrations: async () => (await call(api.GET('/api/v1/admin/system/integrations'))) as unknown as IntegrationSetting[],
  saveIntegration: (key: string, input: SaveIntegrationSetting) =>
    call(
      api.PUT('/api/v1/admin/system/integrations/{key}', {
        params: { path: { key } },
        body: body<Schemas['SaveIntegrationSettingDto']>(input),
      }),
    ),
  integrationLogs: async (params: IntegrationLogsQuery) =>
    (await call(
      api.GET('/api/v1/admin/system/integration-logs', { params: { query: query({ ...params }) } }),
    )) as unknown as Page<IntegrationLogRecord>,
  failedJobs: async (params: { open?: boolean; page?: number }) =>
    (await call(
      api.GET('/api/v1/admin/system/failed-jobs', {
        params: { query: query({ open: params.open === undefined ? undefined : String(params.open), page: params.page }) },
      }),
    )) as unknown as Page<FailedJob>,
  retryJob: (id: string) => call(api.POST('/api/v1/admin/system/failed-jobs/{id}/retry', { params: { path: { id } } })),
  resolveJob: (id: string) => call(api.POST('/api/v1/admin/system/failed-jobs/{id}/resolve', { params: { path: { id } } })),
};

/**
 * Лента событий (модуль Notifications). 404 — модуль ещё не развёрнут на стенде,
 * 403 — у роли нет очередей: лента отключается без ошибок (см. feed/connection.ts).
 */
export const feedApi = {
  ticket: async () => (await call(api.POST('/api/v1/admin/feed/ticket'))) as FeedTicket,
  recent: async (since: string) =>
    (await call(api.GET('/api/v1/admin/feed/recent', { params: { query: { since, limit: 200 } } }))) as unknown,
  streamUrl: (ticket: string) => `${API_BASE_URL}/api/v1/admin/feed/stream?ticket=${encodeURIComponent(ticket)}`,
};
