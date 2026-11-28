import { db, pool } from '../db/client.js';
import { recordAudit } from '../modules/admin/auditLog.js';
import { CLI_ACTOR_ID } from '../modules/admin/adminActor.js';
import { removeAuthenticator } from '../modules/auth/authenticators.js';
import { destroyAdminSessionsForUser } from '../modules/auth/session.js';
import { findByUsernameLower } from '../modules/users/users.js';

// `bun run auth:remove-authenticator <username>`
//
// For someone who lost both the phone with their authenticator app and their recovery codes: removes the app and
// its codes, so the account signs in with its password again (or with its email code, if two-step login by email
// is on) and can set up a new app. Its open panel sessions end too. Runs against DATABASE_URL, needs shell access
// to the server, and leaves an audit entry with the actor recorded as `cli`. Check who is asking before running it.

const username = (process.argv[2] ?? '').trim();

async function main(): Promise<number> {
  if (!username) {
    console.error('uso: auth:remove-authenticator <usuario>');
    return 2;
  }
  const target = await findByUsernameLower(username);
  if (!target) {
    console.error(`conta "${username}" não encontrada`);
    return 1;
  }
  const removed = await db.transaction(async (tx) => {
    const had = await removeAuthenticator(target.id, tx);
    if (had) await destroyAdminSessionsForUser(target.id, tx);
    return had;
  });
  if (!removed) {
    console.error(`nada mudou: @${target.username} não tem app autenticador ativo`);
    return 1;
  }
  await recordAudit({
    actor: { id: CLI_ACTOR_ID, username: 'cli' }, action: 'account.authenticator_remove', targetType: 'user', targetId: target.id,
    targetLabel: target.username, reason: 'via linha de comando',
  });
  console.log(`app autenticador removido de @${target.username}`);
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => { console.error(err instanceof Error ? err.stack : err); process.exitCode = 1; })
  .finally(() => { void pool.end(); });
