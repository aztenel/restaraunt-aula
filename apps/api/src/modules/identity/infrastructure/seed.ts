import { INestApplicationContext } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { newId } from '../../../shared/kernel/ids';
import { randomCode } from '../../../shared/kernel/random';
import { WEEKDAYS } from '../../../shared/kernel/time';
import { PasswordHasher } from '../application/password-hasher';
import { RoleAssignment } from '../domain/roles';
import { DEFAULT_BRANCH_SETTINGS } from '../public/branch-directory';
import { StaffRole } from '../public/staff-directory';
import { BranchRepository } from './branch.repository';
import { LegalEntityRepository } from './legal-entity.repository';
import { UserRepository } from './user.repository';

/**
 * Стартовые данные Identity по открытым источникам (ТЗ, 25.09.2026):
 * юрлицо «Express kitchen» ЖШС (адрес регистрации — Кабанбай батыр 56), два действующих филиала.
 * БИН, банковские реквизиты, координаты и часы работы — гипотезы, уточняются в админке.
 */
const ALL_DAY_HOURS = Object.fromEntries(WEEKDAYS.map((d) => [d, [{ open: '10:00', close: '00:00' }]]));

const BRANCHES = [
  {
    code: 'GL',
    slug: 'greenline',
    name: { ru: 'AULA GreenLine Aqua', kk: 'AULA GreenLine Aqua', en: 'AULA GreenLine Aqua' },
    address: {
      ru: 'Астана, ул. Е-899, 1/1 (ЖК GreenLine Aqua)',
      kk: 'Астана, Е-899 көшесі, 1/1 (GreenLine Aqua ТК)',
      en: 'Astana, E-899 street 1/1 (GreenLine Aqua)',
    },
    location: { lat: 51.0762, lng: 71.4125 },
    sortOrder: 1,
  },
  {
    code: 'GV',
    slug: 'garden-view',
    name: { ru: 'AULA Garden View', kk: 'AULA Garden View', en: 'AULA Garden View' },
    address: {
      ru: 'Астана, пр. Кабанбай батыра, 56 (ЖК Garden View)',
      kk: 'Астана, Қабанбай батыр даңғылы, 56 (Garden View ТК)',
      en: 'Astana, Kabanbay Batyr ave. 56 (Garden View)',
    },
    location: { lat: 51.0906, lng: 71.4187 },
    sortOrder: 2,
  },
];

export async function seedIdentity(
  app: INestApplicationContext,
  options: { demo: boolean; ownerEmail: string; ownerPassword?: string; adminEmail: string; adminPassword?: string; log: (m: string) => void },
): Promise<{ branches: Record<string, string>; legalEntityId: string; ownerUserId: string }> {
  const database = app.get(Database);
  const legalEntities = app.get(LegalEntityRepository);
  const branchesRepo = app.get(BranchRepository);
  const users = app.get(UserRepository);
  const hasher = app.get(PasswordHasher);

  return database.transaction(async () => {
    let legal = await legalEntities.findDefault();
    if (!legal) {
      const id = newId();
      await legalEntities.insert(id, {
        name: 'ТОО «Express kitchen»',
        shortName: 'Express kitchen',
        bin: '000000000000',
        legalAddress: 'Республика Казахстан, г. Астана, пр. Кабанбай батыра, 56',
        actualAddress: null,
        directorName: 'Указать в админке',
        directorPosition: 'Директор',
        actingBasis: 'Устава',
        bankName: '',
        iban: '',
        bik: '',
        kbe: '17',
        vatPayer: false,
        vatRateBp: 0,
        vatCertificate: null,
        phone: null,
        email: null,
        isDefault: true,
      });
      legal = (await legalEntities.findById(id))!;
      options.log('Юрлицо по умолчанию создано (заполните БИН и реквизиты в админке)');
    }

    const branches: Record<string, string> = {};
    for (const b of BRANCHES) {
      const existing = await branchesRepo.findBySlug(b.slug);
      if (existing) {
        branches[b.slug] = existing.id;
        continue;
      }
      const id = newId();
      await branchesRepo.insert(id, {
        code: b.code,
        slug: b.slug,
        name: b.name,
        address: b.address,
        location: b.location,
        phone: '+77172000000',
        whatsapp: null,
        email: null,
        timezone: 'Asia/Almaty',
        openingHours: ALL_DAY_HOURS,
        settings: { ...DEFAULT_BRANCH_SETTINGS },
        legalEntityId: legal.id,
        isActive: true,
        sortOrder: b.sortOrder,
      });
      branches[b.slug] = id;
      options.log(`Филиал ${b.code} ${b.slug} создан`);
    }

    const ensureUser = async (email: string, name: string, roles: RoleAssignment[], password?: string) => {
      const existing = await users.findByEmail(email);
      if (existing) return existing.id;
      const id = newId();
      const pwd = password ?? `Tmp!${randomCode(12)}x`;
      await users.insert({
        id,
        email,
        name,
        phone: null,
        telegramChatId: null,
        passwordHash: await hasher.hash(pwd),
        mustChangePassword: !password,
      });
      await users.replaceRoles(id, roles);
      options.log(`Пользователь ${email} (${roles.map((r) => r.role).join(', ')}) создан${password ? '' : `, временный пароль: ${pwd}`}`);
      return id;
    };

    const ownerUserId = await ensureUser(options.ownerEmail, 'Собственник', [{ role: 'owner', branchId: null }], options.ownerPassword);
    await ensureUser(options.adminEmail, 'Администратор системы', [{ role: 'sysadmin', branchId: null }], options.adminPassword);

    if (options.demo) {
      const demoPassword = 'Demo-Password-2026!';
      const demo: Array<[string, string, StaffRole, string | null]> = [
        ['operator.gl@aula.demo', 'Оператор GreenLine', 'branch_operator', branches.greenline!],
        ['operator.gv@aula.demo', 'Оператор Garden View', 'branch_operator', branches['garden-view']!],
        ['manager.gl@aula.demo', 'Управляющий GreenLine', 'branch_manager', branches.greenline!],
        ['manager.gv@aula.demo', 'Управляющий Garden View', 'branch_manager', branches['garden-view']!],
        ['banquet@aula.demo', 'Банкетный менеджер', 'banquet_manager', null],
        ['content@aula.demo', 'Контент-менеджер', 'content_manager', null],
        ['finance@aula.demo', 'Финансы', 'finance', null],
      ];
      for (const [email, name, role, branchId] of demo) {
        await ensureUser(email, name, [{ role, branchId }], demoPassword);
      }
      options.log(`Демо-сотрудники созданы, пароль: ${demoPassword}`);
    }

    return { branches, legalEntityId: legal.id, ownerUserId };
  });
}
