import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { adminAuditLogs, reports, servers, sessions, userAuthenticators, users, webhooks } from '../../src/db/schema.js';
import { claimReport } from '../../src/modules/admin/adminReports.js';
import { assignServerOwner, deleteServerAsAdmin, reactivateServer, suspendServer } from '../../src/modules/admin/adminServers.js';
import { revokeUserSessions } from '../../src/modules/admin/adminUsers.js';
import { revokeWebhook } from '../../src/modules/admin/adminWebhooks.js';
import { createSession } from '../../src/modules/auth/session.js';
import { db, makeServerWithMembers, makeUser, pool } from './helpers.js';

// The route checks the admin before the action; the action checks again under its own locks, so one demoted,
// suspended or left without an authenticator app in between does nothing, and leaves no trail of having acted.

after(() => pool.end());

const ctx = (actor: { id: string; username: string }) => ({ actor, reason: 'itest decision', requestId: crypto.randomUUID() });

async function formerAdmins() {
  const demoted = await makeUser('dem', 'admin');
  await db.update(users).set({ role: 'user' }).where(eq(users.id, demoted.id));
  const suspended = await makeUser('sus', 'admin');
  await db.update(users).set({ status: 'suspended' }).where(eq(users.id, suspended.id));
  const withoutApp = await makeUser('noapp', 'admin');
  await db.delete(userAuthenticators).where(eq(userAuthenticators.userId, withoutApp.id));
  return [demoted, suspended, withoutApp];
}

const trailOf = async (actorId: string) => db.select().from(adminAuditLogs).where(eq(adminAuditLogs.actorId, actorId));

describe('admin actions re-check the acting admin', () => {
  it('refuses server, webhook, report and session actions from a former admin', async () => {
    const owner = await makeUser('own');
    const member = await makeUser('mem');
    const { serverId, textChannelId } = await makeServerWithMembers(owner.id, [member.id]);
    const webhookId = crypto.randomUUID();
    await db.insert(webhooks).values({ id: webhookId, conversationId: textChannelId, tokenHash: 'original' });
    const reportId = crypto.randomUUID();
    await db.insert(reports).values({ id: reportId, reporterId: member.id, targetType: 'user', targetId: owner.id, targetLabel: 'own', category: 'spam' });
    await createSession(member.id);

    for (const actor of await formerAdmins()) {
      const c = ctx(actor);
      assert.equal((await suspendServer(c, serverId)).code, 'forbidden');
      assert.equal((await assignServerOwner(c, serverId, member.id)).code, 'forbidden');
      assert.equal((await deleteServerAsAdmin(c, serverId, 'itest')).code, 'forbidden');
      assert.equal((await revokeWebhook(c, webhookId)).code, 'forbidden');
      assert.equal((await claimReport(c, reportId)).code, 'forbidden');
      assert.equal((await revokeUserSessions(c, member.id)).code, 'forbidden');
      assert.deepEqual(await trailOf(actor.id), [], `${actor.username} left no trail`);
    }

    const [server] = await db.select().from(servers).where(eq(servers.id, serverId));
    assert.deepEqual([server?.status, server?.ownerId], ['active', owner.id]);
    assert.equal((await db.select().from(webhooks).where(eq(webhooks.id, webhookId)))[0]?.tokenHash, 'original');
    assert.equal((await db.select().from(reports).where(eq(reports.id, reportId)))[0]?.status, 'open');
    assert.equal((await db.select().from(sessions).where(eq(sessions.userId, member.id))).length, 1);
  });

  it('lets an active admin with an app act, and reactivating needs the same', async () => {
    const owner = await makeUser('own');
    const { serverId } = await makeServerWithMembers(owner.id, []);
    const admin = await makeUser('act', 'admin');
    const [demoted] = await formerAdmins();
    assert.equal((await suspendServer(ctx(admin), serverId)).code, 'ok');
    assert.equal((await reactivateServer(ctx(demoted!), serverId)).code, 'forbidden');
    assert.equal((await db.select().from(servers).where(eq(servers.id, serverId)))[0]?.status, 'suspended');
    const trail = await db.select().from(adminAuditLogs).where(and(eq(adminAuditLogs.actorId, admin.id), eq(adminAuditLogs.action, 'server.suspend')));
    assert.equal(trail.length, 1);
  });
});
