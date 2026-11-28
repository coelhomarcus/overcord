import { uploadDir } from './isolatedUploadDir.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { adminAuditLogs, users } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { DUMP_FILE, MANIFEST_FILE, README_FILE } from '../../src/modules/backups/backupLayout.js';
import { claimDownload, issueDownloadToken, releaseDownload, setBackupIdleTimeout } from '../../src/modules/backups/backupDownload.js';
import { listZipEntries, readBackupZip } from '../../src/modules/backups/backupZipReader.js';
import { adminHeaders, db, makeAdminSession, makeUser, pool } from './helpers.js';

// The admin backup download end to end, on the real database and disk. pg_dump
// is a stand-in script (PG_DUMP_BIN): the runner's client tools may be older than
// its server, and what is tested here is the route, the link and the stream, not
// pg_dump itself (`bun run backup:rehearse` covers the real one).

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'overcord-itest-backup-'));
const fakePgDump = path.join(scratch, 'pg_dump');
fs.writeFileSync(fakePgDump, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "pg_dump (PostgreSQL) 17.0"; else printf "PGDMP stand-in dump"; fi\n', { mode: 0o755 });
const savedPgDump = process.env.PG_DUMP_BIN;
process.env.PG_DUMP_BIN = fakePgDump;

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => {
  await app.close();
  await pool.end();
  if (savedPgDump === undefined) delete process.env.PG_DUMP_BIN; else process.env.PG_DUMP_BIN = savedPgDump;
  fs.rmSync(uploadDir, { recursive: true, force: true });
  fs.rmSync(scratch, { recursive: true, force: true });
});
/** Every email the app hands to Resend in a test, read back for its code. */
let mailbox: { to: string[]; text: string }[] = [];
const savedEmail = { key: config.RESEND_API_KEY, from: config.RESEND_FROM_EMAIL };
beforeEach(() => {
  mailbox = [];
  config.RESEND_API_KEY = 're_test';
  config.RESEND_FROM_EMAIL = 'Overcord <noreply@example.test>';
  mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    mailbox.push(JSON.parse(String(init.body)));
    return new Response('{}', { status: 200 });
  });
});
afterEach(() => {
  process.env.PG_DUMP_BIN = fakePgDump;
  mock.restoreAll();
  config.RESEND_API_KEY = savedEmail.key;
  config.RESEND_FROM_EMAIL = savedEmail.from;
});

const PASSWORD = 'correct horse battery';
let passwordHash: Promise<string> | null = null;

async function admin(prefix = 'bkadmin') {
  const id = crypto.randomUUID();
  const username = `${prefix}_${id.slice(0, 8)}`;
  passwordHash ??= hashPassword(PASSWORD);
  await db.insert(users).values({ id, username, passwordHash: await passwordHash, role: 'admin', email: `${username}@example.test`, twoFactorEmail: true });
  return { id, username, token: await makeAdminSession(id) };
}

function lastCode(): string {
  const match = mailbox.at(-1)?.text.match(/\b(\d{6})\b/);
  assert.ok(match, 'an email with a 6-digit code should have been sent');
  return match[1]!;
}

const request = (method: 'GET' | 'POST', url: string, token?: string, body?: unknown) => app.inject({
  method, url, headers: { ...adminHeaders(token), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { payload: JSON.stringify(body) } : {}),
});

/** Both steps of issuing a link: the password earns a code by email, the code earns the link. */
async function issue(a: { token: string }, reason: string) {
  const sent = await request('POST', '/api/admin/backup/download/request', a.token, { reason, password: PASSWORD });
  assert.equal(sent.statusCode, 200, sent.body);
  return request('POST', '/api/admin/backup/download', a.token, { reason, code: lastCode() });
}

describe('admin backup download', () => {
  it('reports what the backup will hold', async () => {
    const a = await admin();
    const res = await request('GET', '/api/admin/backup', a.token);
    assert.equal(res.statusCode, 200);
    const info = res.json() as { available: boolean; running: unknown; estimate: { databaseBytes: number; files: number }; recent: unknown[] };
    assert.equal(info.available, true);
    assert.equal(info.running, null);
    assert.ok(info.estimate.databaseBytes > 0);
    assert.ok(Array.isArray(info.recent));
  });

  it('streams a ZIP the restore accepts, through a link that works once and only for its admin', async () => {
    const a = await admin();
    const other = await admin('bkother');
    fs.writeFileSync(path.join(uploadDir, 'f'.repeat(32)), 'stored file bytes');

    const issued = await issue(a, 'before the upgrade');
    assert.equal(issued.statusCode, 200);
    const { url } = issued.json() as { url: string };
    assert.match(url, /^\/api\/admin\/backup\/download\/[\w-]{40,}$/);

    // another admin's session cannot spend it, and trying does not burn it
    const stolen = await request('GET', url, other.token);
    assert.equal(stolen.statusCode, 404);
    assert.equal((stolen.json() as { error: { code: string } }).error.code, 'backup_link_expired');

    const res = await request('GET', url, a.token);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'application/zip');
    assert.match(String(res.headers['content-disposition']), /^attachment; filename="overcord-backup-\d{8}T\d{6}Z\.zip"$/);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['content-encoding'], undefined);

    const zip = path.join(scratch, 'download.zip');
    fs.writeFileSync(zip, res.rawPayload);
    const entries = await listZipEntries(zip);
    assert.deepEqual([entries[0], entries[1], entries.at(-1)], [README_FILE, DUMP_FILE, MANIFEST_FILE]);
    assert.ok(entries.includes(`uploads/${'f'.repeat(32)}`));
    const manifest = await readBackupZip(zip);
    assert.ok(manifest.tables.users! >= 2);

    assert.equal((await request('GET', url, a.token)).statusCode, 404, 'a link works once');

    const trail = await db.select().from(adminAuditLogs).where(and(eq(adminAuditLogs.action, 'system.backup_download'), eq(adminAuditLogs.actorId, a.id)));
    assert.deepEqual(trail.map((row) => [row.result, row.reason]), [['ok', 'before the upgrade']]);
  });

  it('needs a reason, an admin and the admin origin to issue a link', async () => {
    const a = await admin();
    const user = await makeUser('bkuser', 'user', true);
    assert.equal((await request('POST', '/api/admin/backup/download', a.token, {})).statusCode, 400);
    assert.equal((await request('POST', '/api/admin/backup/download', await makeAdminSession(user.id), { reason: 'curious' })).statusCode, 403);
    const foreign = await app.inject({
      method: 'POST', url: '/api/admin/backup/download', payload: JSON.stringify({ reason: 'cross-site' }),
      headers: { ...adminHeaders(a.token), origin: 'https://evil.example', 'content-type': 'application/json' },
    });
    assert.equal(foreign.statusCode, 403);
    assert.equal((await request('GET', '/api/admin/backup/download/not-a-token', a.token)).statusCode, 404);
  });

  it('issues a link only for the password and a code bound to the session and the reason', async () => {
    const a = await admin();
    const reason = 'before the upgrade';
    const download = (token: string, body: Record<string, string>) => request('POST', '/api/admin/backup/download', token, { reason, ...body });
    const refusal = (res: Awaited<ReturnType<typeof request>>) => [res.statusCode, (res.json() as { error: { code: string } }).error.code];

    assert.deepEqual(refusal(await download(a.token, {})), [400, 'invalid_code'], 'a reason alone is not enough');
    assert.deepEqual(refusal(await request('POST', '/api/admin/backup/download/request', a.token, { reason, password: 'wrong' })), [403, 'invalid_password']);
    assert.equal(mailbox.length, 0, 'no code for a wrong password');

    const sent = await request('POST', '/api/admin/backup/download/request', a.token, { reason, password: PASSWORD });
    assert.equal(sent.statusCode, 200);
    assert.equal((sent.json() as { codeRequired: boolean }).codeRequired, true);
    const code = lastCode();
    assert.deepEqual(refusal(await download(await makeAdminSession(a.id), { code })), [400, 'invalid_code'], 'another session of the same admin');
    assert.deepEqual(refusal(await request('POST', '/api/admin/backup/download', a.token, { reason: 'another reason', code })), [400, 'invalid_code']);
    const issued = await download(a.token, { code });
    assert.equal(issued.statusCode, 200);
    assert.deepEqual(refusal(await download(a.token, { code })), [400, 'invalid_code'], 'a code works once');
  });

  it('runs one backup at a time', async () => {
    const a = await admin();
    const holder = await admin('bkholder');
    const held = issueDownloadToken({ id: holder.id, username: holder.username }, 'holding the lock');
    assert.equal(held.code, 'ok');
    assert.equal(claimDownload(held.code === 'ok' ? held.token : '', { id: holder.id, username: holder.username }).code, 'ok');
    try {
      const busy = await request('POST', '/api/admin/backup/download/request', a.token, { reason: 'second one', password: PASSWORD });
      assert.equal(busy.statusCode, 409);
      assert.equal((busy.json() as { error: { code: string } }).error.code, 'backup_running');
      const info = (await request('GET', '/api/admin/backup', a.token)).json() as { running: { by: string } | null };
      assert.equal(info.running?.by, holder.username);
    } finally {
      releaseDownload();
    }
  });

  it('records a run that fails midway, ends the download as failed and frees the lock', async () => {
    const a = await admin();
    const failing = path.join(scratch, 'pg_dump-failing');
    fs.writeFileSync(failing, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "pg_dump (PostgreSQL) 17.0"; exit 0; fi\necho "pg_dump: error: query failed" >&2; exit 1\n', { mode: 0o755 });
    process.env.PG_DUMP_BIN = failing;
    const { url } = (await issue(a, 'will fail')).json() as { url: string };
    // headers are out before the failure, so the response is cut rather than answered with an error
    const res = await request('GET', url, a.token).catch(() => null);
    if (res) assert.ok(!res.rawPayload.includes(MANIFEST_FILE), 'never a complete ZIP');

    const failed = async () => (await db.select().from(adminAuditLogs).where(and(eq(adminAuditLogs.actorId, a.id), eq(adminAuditLogs.result, 'failed'))))[0];
    for (let i = 0; i < 50 && !(await failed()); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.match(String((await failed())?.detail.error), /pg_dump failed/);
    process.env.PG_DUMP_BIN = fakePgDump;
    assert.equal((await issue(a, 'again')).statusCode, 200, 'the lock was released');
  });

  it('stops a download that does not move, so a stalled client cannot hold the lock', async () => {
    const a = await admin();
    const stuck = path.join(scratch, 'pg_dump-stuck');
    fs.writeFileSync(stuck, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "pg_dump (PostgreSQL) 17.0"; exit 0; fi\nexec sleep 30\n', { mode: 0o755 });
    process.env.PG_DUMP_BIN = stuck;
    setBackupIdleTimeout(400);
    try {
      const { url } = (await issue(a, 'stalls')).json() as { url: string };
      const started = Date.now();
      await request('GET', url, a.token).catch(() => null);
      assert.ok(Date.now() - started < 15_000, 'the download was cut, not left hanging');
      const failed = async () => (await db.select().from(adminAuditLogs).where(and(eq(adminAuditLogs.actorId, a.id), eq(adminAuditLogs.result, 'failed'))))[0];
      for (let i = 0; i < 50 && !(await failed()); i++) await new Promise((resolve) => setTimeout(resolve, 100));
      assert.match(String((await failed())?.detail.error), /Nothing was downloaded/);
      process.env.PG_DUMP_BIN = fakePgDump;
      let next = 0;
      for (let i = 0; i < 50 && next !== 200; i++) {
        next = (await request('POST', '/api/admin/backup/download/request', a.token, { reason: 'after the stall', password: PASSWORD })).statusCode;
        if (next !== 200) await new Promise((resolve) => setTimeout(resolve, 200));
      }
      assert.equal(next, 200, 'the lock was released once the script exited');
      assert.equal((await request('POST', '/api/admin/backup/download', a.token, { reason: 'after the stall', code: lastCode() })).statusCode, 200);
    } finally {
      setBackupIdleTimeout();
    }
  });

  it('says so when the server cannot run pg_dump, before a link is issued', async () => {
    const a = await admin();
    process.env.PG_DUMP_BIN = path.join(scratch, 'missing-pg_dump');
    assert.equal(((await request('GET', '/api/admin/backup', a.token)).json() as { available: boolean }).available, false);
    const res = await request('POST', '/api/admin/backup/download/request', a.token, { reason: 'no tools', password: PASSWORD });
    assert.equal(res.statusCode, 503);
    assert.equal((res.json() as { error: { code: string } }).error.code, 'backup_unavailable');
  });
});
