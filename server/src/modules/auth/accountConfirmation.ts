import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '../../db/schema.js';
import { jsonBody, sendError, sendJson } from '../../http/respond.js';
import { config } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import type { SessionUser } from '../../types.js';
import { resolveLocale } from '../users/locale.js';
import { findById } from '../users/users.js';
import { issueAuthChallenge, issueAuthCode, verifyAuthChallenge, verifyAuthCode, type AuthCodePurpose, type ChallengePurpose } from './codes.js';
import { acceptSecondFactorCode, hasAuthenticator } from './authenticators.js';
import { isEmailDeliveryConfigured, sendAuthCodeEmail } from './email.js';
import { verifyPassword } from './password.js';
import * as ratelimit from './ratelimit.js';

const log = logger.child({ component: 'auth' });

// What a signed-in person proves before a sensitive action: the current password and, with two-step login
// on, a code sent to the account's current email. The auth routes and the data export both ask for it.

// Code emails a person can ask for (a login code, a two-step setup code): a request limit, not a mistake
// limit, so a resend button cannot become a mail cannon.
export const CODE_SEND_RULE: ratelimit.Rule = { windowMs: 15 * 60 * 1000, max: 5 };

// One counter of wrong codes per account, shared by the login's second step and the two-step setup:
// each code also allows only AUTH_CODE_MAX_ATTEMPTS, but a resend starts a new code, so this is what
// bounds guessing across codes (and it survives a restart, see ratelimit.ts).
export const codeFailuresKey = (userId: string) => `code:${userId}`;
// Wrong current passwords on the logged-in confirmations (two-step, password change).
const passwordConfirmKey = (userId: string) => `pw-confirm:${userId}`;

/** `ana@gmail.com` → `a**@gmail.com`: enough to recognize the address on the login screen. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}${'*'.repeat(Math.max(2, at - 1))}${email.slice(at)}`;
}

export function rateLimitedReply(reply: FastifyReply, retryAfterSec: number, message = 'Muitas tentativas. Tente novamente mais tarde.'): void {
  reply.header('Retry-After', String(retryAfterSec));
  sendError(reply, 429, 'rate_limited', message);
}

export function purposeError(reply: FastifyReply, reason: 'invalid_code' | 'code_expired' | 'too_many_attempts'): void {
  const messages = {
    invalid_code: 'Código inválido.',
    code_expired: 'Código expirado. Solicite um novo código.',
    too_many_attempts: 'Limite de tentativas atingido. Solicite um novo código.',
  } as const;
  sendError(reply, 400, reason, messages[reason]);
}

export async function issueAndSendCode(
  userId: string, email: string, username: string, purpose: AuthCodePurpose, locale: ReturnType<typeof resolveLocale>, challengeHash?: string,
): Promise<void> {
  const code = await issueAuthCode(userId, purpose, email, { challengeHash, ttlMs: purpose === 'login' ? config.LOGIN_CODE_TTL_MS : undefined });
  try {
    await sendAuthCodeEmail({ to: email, code, purpose, username, locale });
  } catch (err) {
    log.error('failed to send code', err);
    throw err;
  }
}

/** Checks the current password asked for before a sensitive change, under its own attempt counter.
 * Answers the request itself (and returns false) when it is wrong or blocked. */
export async function confirmPassword(reply: FastifyReply, sess: SessionUser, password: string): Promise<boolean> {
  const key = passwordConfirmKey(sess.userId);
  const blocked = await ratelimit.checkBlocked(key);
  if (blocked) { rateLimitedReply(reply, blocked); return false; }
  const user = await findById(sess.userId);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    await ratelimit.recordFailure(key);
    log.warn('wrong current password on a security change', { userId: sess.userId });
    sendError(reply, 403, 'invalid_password', 'Senha incorreta.');
    return false;
  }
  await ratelimit.reset(key).catch(() => {});
  return true;
}

// With two-step login on, the account's second factor (its authenticator app, else its current email) is asked
// again after the password by everything that could take it away: deleting the account, turning two-step login or
// sign-in alerts off, and moving the address. Exporting the account's data asks it too: a stolen session plus a leaked password
// would otherwise walk off with every DM in one archive. That pair is exactly what two-step login is for.
const CURRENT_EMAIL_CODE_SEND_KEYS = {
  account_deletion: 'deletion-code',
  two_factor_disable: '2fa-disable-code',
  login_alert_disable: 'login-alert-code',
  email_change_current: 'email-change-current-code',
  data_export: 'data-export-code',
  admin_role_change: 'admin-role-code',
  admin_backup: 'admin-backup-code',
  admin_account_action: 'admin-account-code',
  authenticator_setup: 'authenticator-setup-code',
} as const satisfies Partial<Record<AuthCodePurpose, string>>;
export type CurrentEmailPurpose = keyof typeof CURRENT_EMAIL_CODE_SEND_KEYS;

/** Sends a code of `purpose` to the account's current address and answers `{ codeRequired, email }`. */
export async function sendCurrentEmailCode(reply: FastifyReply, user: User, purpose: CurrentEmailPurpose, challengeHash?: string): Promise<void> {
  if (!user.email || !isEmailDeliveryConfigured()) {
    return sendError(reply, 503, 'email_unavailable', 'Não foi possível enviar o código de verificação agora. Tente novamente mais tarde.');
  }
  const send = await ratelimit.consume(`${CURRENT_EMAIL_CODE_SEND_KEYS[purpose]}:${user.id}`, CODE_SEND_RULE);
  if (!send.allowed) return rateLimitedReply(reply, send.retryAfterSec, 'Muitos códigos enviados. Tente novamente mais tarde.');
  try {
    await issueAndSendCode(user.id, user.email, user.username, purpose, resolveLocale(user.locale), challengeHash);
  } catch {
    return sendError(reply, 503, 'email_unavailable', 'Não foi possível enviar o código de verificação agora. Tente novamente mais tarde.');
  }
  sendJson(reply, 200, { codeRequired: true, method: 'email', email: maskEmail(user.email) });
}

/** Checks the body's `code` against the last one of `purpose` sent to the current address, under the account's
 * counter of wrong codes. A code is only ever sent after the password was confirmed, so it stands for both.
 * Answers the request itself (and returns false) when it is refused. */
export async function verifyCurrentEmailCode(request: FastifyRequest, reply: FastifyReply, sess: Pick<SessionUser, 'userId' | 'email'>, purpose: CurrentEmailPurpose, challengeHash?: string): Promise<boolean> {
  if (!sess.email) { sendError(reply, 400, 'invalid_code', 'Código inválido.'); return false; }
  const code = String(jsonBody(request.body).code ?? '').trim();
  if (!/^\d{6}$/.test(code)) { sendError(reply, 400, 'invalid_code', 'Informe o código de 6 dígitos.'); return false; }
  const key = codeFailuresKey(sess.userId);
  const blocked = await ratelimit.checkBlocked(key);
  if (blocked) { rateLimitedReply(reply, blocked); return false; }
  const result = await verifyAuthCode(sess.userId, purpose, sess.email, code, { challengeHash });
  if (!result.ok) {
    if (result.reason !== 'code_expired') await ratelimit.recordFailure(key);
    purposeError(reply, result.reason);
    return false;
  }
  await ratelimit.reset(key).catch(() => {});
  return true;
}

/** What an account proves after its password: its authenticator app when one is on, which then replaces the email;
 * else its email when two-step login by email is on; else nothing. */
export type SecondFactor = 'authenticator' | 'email';

export async function secondFactorOf(user: Pick<User, 'id' | 'twoFactorEmail'>): Promise<SecondFactor | null> {
  if (await hasAuthenticator(user.id)) return 'authenticator';
  return user.twoFactorEmail ? 'email' : null;
}

/** Starts a challenge the account's authenticator app answers (no email goes out) and answers
 * `{ codeRequired, method }`. Only called once the password was confirmed, so passing it stands for both. */
export async function sendAuthenticatorChallenge(reply: FastifyReply, user: Pick<User, 'id' | 'email'>, purpose: ChallengePurpose, challengeHash?: string): Promise<void> {
  await issueAuthChallenge(user.id, purpose, user.email ?? '', { challengeHash });
  sendJson(reply, 200, { codeRequired: true, method: 'authenticator' });
}

/** Checks the body's `code`, from the app or a recovery code, against the latest challenge of `purpose`, under the
 * account's counter of wrong codes. Returns which of the two passed, or null after answering the refusal. */
export async function verifyAuthenticatorChallenge(
  request: FastifyRequest, reply: FastifyReply, userId: string, purpose: ChallengePurpose, challengeHash?: string,
): Promise<'authenticator' | 'recovery_code' | null> {
  const code = String(jsonBody(request.body).code ?? '').trim();
  if (!code || code.length > 32) { sendError(reply, 400, 'invalid_code', 'Informe o código do app autenticador.'); return null; }
  const key = codeFailuresKey(userId);
  const blocked = await ratelimit.checkBlocked(key);
  if (blocked) { rateLimitedReply(reply, blocked); return null; }
  let used: 'authenticator' | 'recovery_code' | null = null;
  const result = await verifyAuthChallenge(userId, purpose, async () => (used = await acceptSecondFactorCode(userId, code)) !== null, { challengeHash });
  if (!result.ok) {
    if (result.reason !== 'code_expired') await ratelimit.recordFailure(key);
    purposeError(reply, result.reason);
    return null;
  }
  await ratelimit.reset(key).catch(() => {});
  return used;
}

/** The second half of a sensitive confirmation, once the password was right: a challenge the authenticator app
 * answers when the account has one (no email goes out), else a code to the current address. */
export async function sendSecondFactorChallenge(reply: FastifyReply, user: User, purpose: CurrentEmailPurpose, challengeHash?: string): Promise<void> {
  if (await hasAuthenticator(user.id)) return sendAuthenticatorChallenge(reply, user, purpose, challengeHash);
  return sendCurrentEmailCode(reply, user, purpose, challengeHash);
}

/** Checks what `sendSecondFactorChallenge` asked for: a code from the app (or a recovery code), else the emailed
 * one. Answers the request itself (and returns false) when it is refused. */
export async function verifySecondFactor(
  request: FastifyRequest, reply: FastifyReply, sess: Pick<SessionUser, 'userId' | 'email'>, purpose: CurrentEmailPurpose, challengeHash?: string,
): Promise<boolean> {
  if (await hasAuthenticator(sess.userId)) return (await verifyAuthenticatorChallenge(request, reply, sess.userId, purpose, challengeHash)) !== null;
  return verifyCurrentEmailCode(request, reply, sess, purpose, challengeHash);
}
