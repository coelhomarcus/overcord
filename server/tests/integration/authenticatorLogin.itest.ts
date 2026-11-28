import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { adminAuditLogs, users } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { createSession } from '../../src/modules/auth/session.js';
import { whenLoginAlertsSettled } from '../../src/modules/auth/loginAlert.js';
import { totpCode, totpStep } from '../../src/modules/auth/totp.js';
import { db, pool } from './helpers.js';

// Two-step login with an authenticator app, end to end over HTTP: setting it up (behind the email when two-step
// login by email is on), signing in with its codes or a recovery code, and turning it off.

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

const PASSWORD = 'correct horse battery';
const freshIp = () => `10.${crypto.randomInt(256)}.${crypto.randomInt(256)}.${crypto.randomInt(1, 255)}`;

let mailbox: { to: string[]; text: string }[] = [];
const saved = { key: config.RESEND_API_KEY, from: config.RESEND_FROM_EMAIL };
beforeEach(() => {
  mailbox = [];
  config.RESEND_API_KEY = 're_test';
  config.RESEND_FROM_EMAIL = 'Overcord <noreply@example.test>';
  mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    mailbox.push(JSON.parse(String(init.body)));
    return new Response('{}', { status: 200 });
  });
});
afterEach(async () => {
  await whenLoginAlertsSettled();
  mock.restoreAll();
  config.RESEND_API_KEY = saved.key;
  config.RESEND_FROM_EMAIL = saved.from;
});

function lastEmailCode(): string {
  const match = mailbox.at(-1)?.text.match(/\b(\d{6})\b/);
  assert.ok(match, 'an email with a code should have been sent');
  return match[1]!;
}

function base32Decode(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** What the app shows `offset` steps from now: each use below takes a newer step, as a person would wait for. */
const appCode = (secret: string, offset = 0) => totpCode(base32Decode(secret), totpStep(Date.now()) + offset);

async function makeAccount(opts: { twoFactorEmail?: boolean } = {}) {
  const id = crypto.randomUUID();
  const username = `otp_${id.slice(0, 8)}`;
  await db.insert(users).values({ id, username, email: `${username}@example.test`, passwordHash: await hashPassword(PASSWORD), twoFactorEmail: opts.twoFactorEmail ?? false });
  const { rawToken } = await createSession(id);
  return { id, username, cookie: `${config.SESSION_COOKIE}=${rawToken}` };
}

async function call(method: 'GET' | 'POST' | 'PUT', url: string, opts: { payload?: Record<string, unknown>; cookie?: string } = {}) {
  const ip = freshIp();
  const res = await app.inject({ method, url, payload: opts.payload, remoteAddress: ip, headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), 'x-forwarded-for': ip } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, setCookie: res.headers['set-cookie'] };
}

/** Sets the app up for `account` and returns its key and recovery codes. */
async function enroll(account: { cookie: string }) {
  const setup = await call('POST', '/api/auth/authenticator/setup', { cookie: account.cookie, payload: { password: PASSWORD } });
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
  const { secret } = setup.body as { secret: string };
  const confirm = await call('POST', '/api/auth/authenticator/confirm', { cookie: account.cookie, payload: { code: appCode(secret, -1) } });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
  return { secret, recoveryCodes: confirm.body.recoveryCodes as string[] };
}

const login = (username: string) => call('POST', '/api/auth/login', { payload: { username, password: PASSWORD } });
const verify = (challenge: string, code: string) => call('POST', '/api/auth/login/verify', { payload: { challenge, code } });

describe('setting up an authenticator app', () => {
  it('a code from the app turns it on and hands out recovery codes once', async () => {
    const account = await makeAccount();
    const setup = await call('POST', '/api/auth/authenticator/setup', { cookie: account.cookie, payload: { password: 'wrong' } });
    assert.equal(setup.status, 403);

    const started = await call('POST', '/api/auth/authenticator/setup', { cookie: account.cookie, payload: { password: PASSWORD } });
    assert.equal(started.status, 200);
    assert.match(started.body.uri, /^otpauth:\/\/totp\/Overcord:otp_/);
    assert.equal((await call('POST', '/api/auth/authenticator/confirm', { cookie: account.cookie, payload: { code: '000000' } })).body.error.code, 'invalid_code');
    const confirmed = await call('POST', '/api/auth/authenticator/confirm', { cookie: account.cookie, payload: { code: appCode(started.body.secret) } });
    assert.equal(confirmed.body.recoveryCodes.length, 10);

    const status = await call('GET', '/api/auth/security', { cookie: account.cookie });
    assert.deepEqual(status.body.authenticator, { available: true, enabled: true, recoveryCodesLeft: 10 });
    assert.equal((await call('POST', '/api/auth/authenticator/setup', { cookie: account.cookie, payload: { password: PASSWORD } })).body.error.code, 'authenticator_enabled');
    const trail = await db.select().from(adminAuditLogs).where(and(eq(adminAuditLogs.targetId, account.id), eq(adminAuditLogs.action, 'account.authenticator_enable')));
    assert.equal(trail.length, 1);
  });

  it('with two-step login by email on, the email is asked before the app replaces it', async () => {
    const account = await makeAccount({ twoFactorEmail: true });
    const asked = await call('POST', '/api/auth/authenticator/setup', { cookie: account.cookie, payload: { password: PASSWORD } });
    assert.equal(asked.body.codeRequired, true);
    assert.equal(asked.body.secret, undefined, 'no key before the email code');
    const other = await createSession(account.id);
    const elsewhere = await call('POST', '/api/auth/authenticator/setup/verify', { cookie: `${config.SESSION_COOKIE}=${other.rawToken}`, payload: { code: lastEmailCode() } });
    assert.equal(elsewhere.body.error.code, 'invalid_code', 'the code belongs to the session that asked');
    const verified = await call('POST', '/api/auth/authenticator/setup/verify', { cookie: account.cookie, payload: { code: lastEmailCode() } });
    assert.equal(verified.status, 200);
    assert.match(verified.body.secret, /^[A-Z2-7]{32}$/);
  });
});

describe('signing in with an authenticator app', () => {
  it('replaces two-step login by email: no code goes to the address any more', async () => {
    const account = await makeAccount({ twoFactorEmail: true });
    await call('POST', '/api/auth/authenticator/setup', { cookie: account.cookie, payload: { password: PASSWORD } });
    const { secret } = (await call('POST', '/api/auth/authenticator/setup/verify', { cookie: account.cookie, payload: { code: lastEmailCode() } })).body;
    await call('POST', '/api/auth/authenticator/confirm', { cookie: account.cookie, payload: { code: appCode(secret, -1) } });
    mailbox = [];
    const first = await login(account.username);
    assert.equal(first.body.twoFactor.method, 'authenticator');
    assert.equal(mailbox.length, 0);
    assert.equal((await verify(first.body.twoFactor.challenge, appCode(secret))).status, 200);
  });

  it('a right password earns a challenge; the app code finishes the login and cannot be replayed', async () => {
    const account = await makeAccount();
    const { secret } = await enroll(account);
    mailbox = [];

    const first = await login(account.username);
    assert.equal(first.status, 200);
    assert.deepEqual(Object.keys(first.body.twoFactor).sort(), ['challenge', 'method']);
    assert.equal(first.body.twoFactor.method, 'authenticator');
    assert.equal(mailbox.length, 0, 'no email goes out');
    assert.equal((await call('POST', '/api/auth/login/resend', { payload: { challenge: first.body.twoFactor.challenge } })).status, 409);

    const code = appCode(secret);
    assert.equal((await verify(first.body.twoFactor.challenge, code === '000000' ? '111111' : '000000')).body.error.code, 'invalid_code');
    const done = await verify(first.body.twoFactor.challenge, code);
    assert.equal(done.status, 200);
    assert.ok(done.setCookie, 'the login sets a session');

    const second = await login(account.username);
    assert.equal((await verify(second.body.twoFactor.challenge, code)).body.error.code, 'invalid_code', 'a used code is refused');
    assert.equal((await verify(second.body.twoFactor.challenge, appCode(secret, 1))).status, 200);
  });

  it('takes a recovery code once, and says so on the audit trail', async () => {
    const account = await makeAccount();
    const { recoveryCodes } = await enroll(account);
    const first = await login(account.username);
    assert.equal((await verify(first.body.twoFactor.challenge, recoveryCodes[0]!.toUpperCase())).status, 200);
    const second = await login(account.username);
    assert.equal((await verify(second.body.twoFactor.challenge, recoveryCodes[0]!)).body.error.code, 'invalid_code');
    const status = await call('GET', '/api/auth/security', { cookie: account.cookie });
    assert.equal(status.body.authenticator.recoveryCodesLeft, 9);
    const trail = await db.select().from(adminAuditLogs).where(and(eq(adminAuditLogs.targetId, account.id), eq(adminAuditLogs.action, 'account.recovery_code_login')));
    assert.equal(trail.length, 1);
  });
});

describe('turning an authenticator app off', () => {
  it('asks the password, then a code from the app; the email takes over again', async () => {
    const account = await makeAccount({ twoFactorEmail: true });
    await call('POST', '/api/auth/authenticator/setup', { cookie: account.cookie, payload: { password: PASSWORD } });
    const { secret } = (await call('POST', '/api/auth/authenticator/setup/verify', { cookie: account.cookie, payload: { code: lastEmailCode() } })).body;
    await call('POST', '/api/auth/authenticator/confirm', { cookie: account.cookie, payload: { code: appCode(secret, -1) } });
    mailbox = [];

    const asked = await call('POST', '/api/auth/authenticator/disable', { cookie: account.cookie, payload: { password: PASSWORD } });
    assert.deepEqual(asked.body, { codeRequired: true, method: 'authenticator' });
    assert.equal(mailbox.length, 0);
    assert.equal((await call('POST', '/api/auth/authenticator/disable/confirm', { cookie: account.cookie, payload: { code: '12345' } })).status, 400);
    const done = await call('POST', '/api/auth/authenticator/disable/confirm', { cookie: account.cookie, payload: { code: appCode(secret) } });
    assert.deepEqual(done.body, { authenticatorEnabled: false });

    const next = await login(account.username);
    assert.equal(next.body.twoFactor.method, 'email');
    assert.equal(mailbox.length, 1);
  });

  it('new recovery codes end the old ones', async () => {
    const account = await makeAccount();
    const { secret, recoveryCodes } = await enroll(account);
    await call('POST', '/api/auth/authenticator/recovery-codes', { cookie: account.cookie, payload: { password: PASSWORD } });
    const fresh = await call('POST', '/api/auth/authenticator/recovery-codes/confirm', { cookie: account.cookie, payload: { code: appCode(secret) } });
    assert.equal(fresh.body.recoveryCodes.length, 10);
    const first = await login(account.username);
    assert.equal((await verify(first.body.twoFactor.challenge, recoveryCodes[0]!)).body.error.code, 'invalid_code');
    assert.equal((await verify(first.body.twoFactor.challenge, fresh.body.recoveryCodes[0])).status, 200);
  });
});

describe('confirming sensitive changes with an authenticator app', () => {
  // two-step login by email off: the app is the account's only second factor, and nothing may skip it
  it('asks the app, not the email, before deleting the account', async () => {
    const account = await makeAccount();
    const { secret } = await enroll(account);
    mailbox = [];
    const asked = await call('POST', '/api/auth/account/deletion/request', { cookie: account.cookie, payload: { password: PASSWORD } });
    assert.deepEqual(asked.body, { codeRequired: true, method: 'authenticator' });
    assert.equal(mailbox.length, 0);
    assert.equal((await call('POST', '/api/auth/account/deletion/confirm', { cookie: account.cookie, payload: { code: '000000' } })).body.error.code, 'invalid_code');
    const done = await call('POST', '/api/auth/account/deletion/confirm', { cookie: account.cookie, payload: { code: appCode(secret) } });
    assert.equal(done.status, 200);
    assert.ok(done.body.deletionDueAt);
  });

  it('asks the app before turning sign-in alerts off and before a data export', async () => {
    const account = await makeAccount();
    const { secret, recoveryCodes } = await enroll(account);
    mailbox = [];
    const alerts = await call('PUT', '/api/auth/login-alerts', { cookie: account.cookie, payload: { enabled: false, password: PASSWORD } });
    assert.deepEqual(alerts.body, { codeRequired: true, method: 'authenticator' });
    const off = await call('POST', '/api/auth/login-alerts/disable/confirm', { cookie: account.cookie, payload: { code: recoveryCodes[0] } });
    assert.equal(off.body.loginAlertEnabled, false, 'a recovery code also confirms');

    const exportAsked = await call('POST', '/api/account/data-export', { cookie: account.cookie, payload: { password: PASSWORD } });
    assert.deepEqual(exportAsked.body, { codeRequired: true, method: 'authenticator' });
    assert.equal((await call('POST', '/api/account/data-export/confirm', { cookie: account.cookie, payload: { code: appCode(secret, 5) } })).body.error.code, 'invalid_code');
    assert.equal(mailbox.length, 0, 'no email for any of it');
  });

  it('moves the email after a code from the app instead of one to the old address', async () => {
    const account = await makeAccount();
    const { secret } = await enroll(account);
    mailbox = [];
    const email = `new_${account.username}@example.test`;
    const asked = await call('POST', '/api/auth/email/change/request', { cookie: account.cookie, payload: { email, password: PASSWORD } });
    assert.deepEqual(asked.body, { codeRequired: true, method: 'authenticator' });
    assert.equal(mailbox.length, 0);
    const verified = await call('POST', '/api/auth/email/change/verify-current', { cookie: account.cookie, payload: { email, code: appCode(secret) } });
    assert.equal(verified.status, 200);
    assert.deepEqual(mailbox.at(-1)?.to, [email], 'the code for the new address goes there');
    const confirmed = await call('POST', '/api/auth/email/change/confirm', { cookie: account.cookie, payload: { email, code: lastEmailCode() } });
    assert.equal(confirmed.status, 200);
  });
});
