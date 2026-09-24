import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createTestApp, TestApp } from '../../../test/support/test-app';
import { createBranch, createLegalEntity, createStaff, TEST_PASSWORD, tokenFor } from '../../../test/support/fixtures';
import { UserRepository } from './infrastructure/user.repository';

describe('Identity (integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ migrateModules: [] });
  });
  afterAll(async () => t.close());
  beforeEach(async () => t.reset());

  async function login(email: string, password = TEST_PASSWORD) {
    return t.http().post('/api/v1/admin/auth/login').send({ email, password });
  }

  it('logs in, returns me with branch-scoped permissions, rotates refresh token', async () => {
    const branchId = await createBranch(t);
    const userId = await createStaff(t, [{ role: 'branch_operator', branchId }]);
    const user = (await t.get(UserRepository).findById(userId))!;

    const res = await login(user.email);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    const cookie = res.headers['set-cookie'] as unknown as string[];
    expect(String(cookie)).toContain('aula_rt=');

    const me = await t.http().get('/api/v1/admin/auth/me').set('authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.branchPermissions[branchId]).toContain('orders.manage');
    expect(me.body.globalPermissions).toEqual([]);

    const refreshed = await t.http().post('/api/v1/admin/auth/refresh').set('Cookie', cookie);
    expect(refreshed.status).toBe(200);
    // Повторное использование старого refresh-токена — отказ и отзыв всех сессий.
    const reused = await t.http().post('/api/v1/admin/auth/refresh').set('Cookie', cookie);
    expect(reused.status).toBe(403);
    const afterReuse = await t.http().post('/api/v1/admin/auth/refresh').set('Cookie', refreshed.headers['set-cookie'] as unknown as string[]);
    expect(afterReuse.status).toBe(403);
  });

  it('locks account after 5 failed attempts and writes audit log', async () => {
    const userId = await createStaff(t, [{ role: 'owner' }]);
    const user = (await t.get(UserRepository).findById(userId))!;
    for (let i = 0; i < 5; i++) {
      expect((await login(user.email, 'wrong-password')).status).toBe(403);
    }
    const locked = await login(user.email);
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe('auth.locked');
    const audit = await sql<{ action: string }>`select action from platform.audit_log where entity_id = ${userId}`.execute(
      t.database.rootConnection(),
    );
    expect(audit.rows.map((r) => r.action)).toContain('auth.locked');
  });

  it('closed by default: 401 without token, 403 without permission', async () => {
    expect((await t.http().get('/api/v1/admin/users')).status).toBe(401);
    const branchId = await createBranch(t);
    const { auth } = await tokenFor(t, [{ role: 'branch_operator', branchId }]);
    const res = await t.http().get('/api/v1/admin/users').set('authorization', auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('access.forbidden');
  });

  it('owner creates a user with branch role; temporary password forces change', async () => {
    const branchId = await createBranch(t);
    const { auth } = await tokenFor(t, [{ role: 'owner' }]);
    const created = await t
      .http()
      .post('/api/v1/admin/users')
      .set('authorization', auth)
      .send({ email: 'op@aula.kz', name: 'Оператор', roles: [{ role: 'branch_operator', branchId }] });
    expect(created.status).toBe(201);
    expect(created.body.temporaryPassword).toBeTruthy();

    const bad = await t
      .http()
      .post('/api/v1/admin/users')
      .set('authorization', auth)
      .send({ email: 'x@aula.kz', name: 'Икс', roles: [{ role: 'branch_operator' }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('user.role_requires_branch');

    const session = await login('op@aula.kz', created.body.temporaryPassword);
    expect(session.body.mustChangePassword).toBe(true);
    const blocked = await t.http().get('/api/v1/admin/branches').set('authorization', `Bearer ${session.body.accessToken}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('auth.password_change_required');
    const changed = await t
      .http()
      .post('/api/v1/admin/auth/change-password')
      .set('authorization', `Bearer ${session.body.accessToken}`)
      .send({ currentPassword: created.body.temporaryPassword, newPassword: 'New-Strong-Pass-1' });
    expect(changed.status).toBe(204);
  });

  it('cannot remove the last owner', async () => {
    const { auth, userId } = await tokenFor(t, [{ role: 'owner' }]);
    const res = await t.http().put(`/api/v1/admin/users/${userId}/roles`).set('authorization', auth).send({ roles: [{ role: 'finance' }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('user.last_privileged');
  });

  it('manages branches and publishes them publicly', async () => {
    await createLegalEntity(t);
    const { auth } = await tokenFor(t, [{ role: 'sysadmin' }]);
    const res = await t
      .http()
      .post('/api/v1/admin/branches')
      .set('authorization', auth)
      .send({
        code: 'GV',
        slug: 'garden-view',
        name: { ru: 'AULA Garden View', kk: 'AULA Garden View' },
        address: { ru: 'Астана, пр. Кабанбай батыра, 56', kk: 'Астана, Қабанбай батыр даңғылы, 56' },
        location: { lat: 51.09, lng: 71.42 },
        phone: '8 717 200 00 00',
        openingHours: { mon: [{ open: '10:00', close: '00:00' }] },
        settings: { deliveryLeadMinutes: 50 },
      });
    expect(res.status).toBe(201);
    expect(res.body.phone).toBe('+77172000000');
    expect(res.body.settings.deliveryLeadMinutes).toBe(50);
    expect(res.body.settings.acceptsDelivery).toBe(true);

    const pub = await t.http().get('/api/v1/public/branches/garden-view');
    expect(pub.status).toBe(200);
    expect(pub.body).not.toHaveProperty('settings');
    expect(pub.body.acceptsDelivery).toBe(true);

    const audit = await t.http().get('/api/v1/admin/system/audit-log?entityType=branch').set('authorization', auth);
    expect(audit.status).toBe(200);
    expect(audit.body.items[0].action).toBe('branch.created');
  });

  it('audit log is append-only at the database level', async () => {
    const { auth } = await tokenFor(t, [{ role: 'owner' }]);
    await t.http().post('/api/v1/admin/users').set('authorization', auth).send({ email: 'a@aula.kz', name: 'Аудит', roles: [] });
    await expect(sql`update platform.audit_log set action = 'x'`.execute(t.database.rootConnection())).rejects.toThrow(/append-only/);
    await expect(sql`delete from platform.audit_log`.execute(t.database.rootConnection())).rejects.toThrow(/append-only/);
  });
});
