import { newId } from '../../src/shared/kernel/ids';
import { PasswordHasher } from '../../src/modules/identity/application/password-hasher';
import { BranchRepository } from '../../src/modules/identity/infrastructure/branch.repository';
import { LegalEntityRepository } from '../../src/modules/identity/infrastructure/legal-entity.repository';
import { UserRepository } from '../../src/modules/identity/infrastructure/user.repository';
import { DEFAULT_BRANCH_SETTINGS, BranchSettings } from '../../src/modules/identity/public/branch-directory';
import { StaffRole } from '../../src/modules/identity/public/staff-directory';
import { BranchDirectoryService } from '../../src/modules/identity/application/directories';
import { ActorResolver } from '../../src/modules/identity/application/actor-resolver';
import { TokenService } from '../../src/modules/identity/application/token.service';
import { TestApp } from './test-app';

export const TEST_PASSWORD = 'Test-Password-123!';

/** Каждый день 10:00-00:00 (закрытие в полночь). */
export const DEFAULT_TEST_HOURS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ open: '10:00', close: '00:00' }]]),
);

export async function createLegalEntity(t: TestApp, overrides: Partial<{ vatPayer: boolean; vatRateBp: number }> = {}) {
  const id = newId();
  await t.get(LegalEntityRepository).insert(id, {
    name: 'ТОО «Express kitchen»',
    shortName: 'Express kitchen',
    bin: String(Math.floor(1e11 + Math.random() * 8e11)).padStart(12, '0'),
    legalAddress: 'г. Астана, пр. Кабанбай батыра, 56',
    actualAddress: null,
    directorName: 'Иванов И.И.',
    directorPosition: 'Директор',
    actingBasis: 'Устава',
    bankName: 'АО «Kaspi Bank»',
    iban: 'KZ000000000000000000',
    bik: 'CASPKZKA',
    kbe: '17',
    vatPayer: overrides.vatPayer ?? false,
    vatRateBp: overrides.vatRateBp ?? 0,
    vatCertificate: null,
    phone: '+77000000000',
    email: 'info@aula.kz',
    isDefault: true,
  });
  return id;
}

export async function createBranch(
  t: TestApp,
  input: Partial<{ code: string; slug: string; settings: Partial<BranchSettings>; legalEntityId: string | null; isActive: boolean }> = {},
) {
  const id = newId();
  const code = input.code ?? `B${Math.floor(Math.random() * 9000 + 1000)}`;
  await t.get(BranchRepository).insert(id, {
    code,
    slug: input.slug ?? code.toLowerCase(),
    name: { ru: `Филиал ${code}`, kk: `${code} филиалы` },
    address: { ru: 'Астана, пр. Кабанбай батыра, 56', kk: 'Астана, Қабанбай батыр даңғ., 56' },
    location: { lat: 51.0906, lng: 71.4187 },
    phone: '+77172000000',
    whatsapp: '+77000000001',
    email: null,
    timezone: 'Asia/Almaty',
    openingHours: DEFAULT_TEST_HOURS,
    settings: { ...DEFAULT_BRANCH_SETTINGS, ...(input.settings ?? {}) },
    legalEntityId: input.legalEntityId ?? null,
    isActive: input.isActive ?? true,
    sortOrder: 0,
  });
  t.get(BranchDirectoryService).invalidate();
  return id;
}

export async function createStaff(t: TestApp, roles: Array<{ role: StaffRole; branchId?: string | null }>, name = 'Сотрудник') {
  const id = newId();
  const hash = await t.get(PasswordHasher).hash(TEST_PASSWORD);
  const users = t.get(UserRepository);
  await users.insert({
    id,
    email: `user-${id.slice(-8)}@aula.test`,
    name,
    phone: null,
    telegramChatId: null,
    passwordHash: hash,
    mustChangePassword: false,
  });
  await users.replaceRoles(
    id,
    roles.map((r) => ({ role: r.role, branchId: r.branchId ?? null })),
  );
  t.get(ActorResolver).invalidate(id);
  return id;
}

/** Access-токен сотрудника без прохождения /login (для тестов других модулей). */
export async function tokenFor(t: TestApp, roles: Array<{ role: StaffRole; branchId?: string | null }>, name?: string) {
  const userId = await createStaff(t, roles, name);
  return { userId, token: t.get(TokenService).signAccess(userId).token, auth: `Bearer ${t.get(TokenService).signAccess(userId).token}` };
}
