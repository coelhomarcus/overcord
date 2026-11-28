import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import { users } from '../../src/db/schema.js';
import { getAdminInsights } from '../../src/modules/admin/adminInsights.js';
import { listAdminUsers } from '../../src/modules/admin/adminUsers.js';
import { makeUser, pool } from './helpers.js';

after(() => pool.end());

describe('admin user list filters (real Postgres)', () => {
  it('finds an account by its exact id, besides name and username', async () => {
    const target = await makeUser('idsearch');
    const other = await makeUser('idsearch');
    const byId = await listAdminUsers({ q: target.id });
    assert.ok(typeof byId === 'object');
    assert.deepEqual(byId.items.map((u) => u.id), [target.id]);

    const byName = await listAdminUsers({ q: target.username });
    assert.ok(typeof byName === 'object');
    assert.ok(byName.items.some((u) => u.id === target.id));
    assert.ok(!byName.items.some((u) => u.id === other.id));
  });

  it('an id is matched exactly: a prefix or a different case finds nothing', async () => {
    const target = await makeUser('idexact');
    for (const q of [target.id.slice(0, 12), target.id.toUpperCase()]) {
      const result = await listAdminUsers({ q });
      assert.ok(typeof result === 'object');
      assert.ok(!result.items.some((u) => u.id === target.id), `"${q}" must not match`);
    }
  });

  it('the role filter accepts plain users as well as admins', async () => {
    const plain = await makeUser('rolep', 'user');
    const admin = await makeUser('rolea', 'admin');
    const users = await listAdminUsers({ q: 'role', role: 'user' });
    const admins = await listAdminUsers({ q: 'role', role: 'admin' });
    assert.ok(typeof users === 'object' && typeof admins === 'object');
    assert.ok(users.items.some((u) => u.id === plain.id) && !users.items.some((u) => u.id === admin.id));
    assert.ok(admins.items.some((u) => u.id === admin.id) && !admins.items.some((u) => u.id === plain.id));
  });
});

describe('admin insights (real Postgres)', () => {
  it('counts accounts on the Belém calendar day they were created, over 30 days', async () => {
    const now = new Date('2030-06-15T12:00:00Z');
    const before = await getAdminInsights(now);
    // 02:59 UTC is still the previous day in Belém (UTC-3); 03:00 is the next one
    const lateEvening = await makeUser('insightlate');
    const midnight = await makeUser('insightmid');
    const tooOld = await makeUser('insightold');
    await db.update(users).set({ createdAt: new Date('2030-06-14T02:59:00Z') }).where(eq(users.id, lateEvening.id));
    await db.update(users).set({ createdAt: new Date('2030-06-14T03:00:00Z') }).where(eq(users.id, midnight.id));
    await db.update(users).set({ createdAt: new Date('2030-05-16T02:59:00Z') }).where(eq(users.id, tooOld.id));

    const after = await getAdminInsights(now);
    assert.equal(after.days.length, 30);
    assert.equal(after.days[0]!.day, '2030-05-17');
    assert.equal(after.days.at(-1)!.day, '2030-06-15');
    const added = (day: string) => after.days.find((d) => d.day === day)!.accounts - before.days.find((d) => d.day === day)!.accounts;
    assert.equal(added('2030-06-13'), 1);
    assert.equal(added('2030-06-14'), 1);
    assert.equal(after.days.reduce((sum, d) => sum + d.accounts, 0) - before.days.reduce((sum, d) => sum + d.accounts, 0), 2);
    assert.deepEqual(Object.keys(after.reports), ['open', 'reviewing', 'resolved', 'dismissed']);
  });
});
