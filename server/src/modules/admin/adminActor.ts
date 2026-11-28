import { sql } from 'drizzle-orm';
import type { Tx } from '../users/userPairLock.js';

/** The CLI acts with shell access to the server; it is not an account. */
export const CLI_ACTOR_ID = 'cli';

/** Whether the acting admin is still an active admin with an authenticator app, holding their rows (FOR SHARE) for
 * the rest of `tx`. The route checked this before the transaction began; a demotion, suspension or removal of their
 * app that lands meanwhile takes these rows FOR UPDATE (or deletes them), so it waits for the action to finish, and
 * an action that runs after it sees the change. */
export async function lockActingAdmin(tx: Tx, actorId: string): Promise<boolean> {
  if (actorId === CLI_ACTOR_ID) return true;
  const { rows } = await tx.execute(sql`
    select u.id from users u join user_authenticators a on a.user_id = u.id
    where u.id = ${actorId} and u.role = 'admin' and u.status = 'active' and a.confirmed_at is not null
    for share of u, a`);
  return rows.length > 0;
}
