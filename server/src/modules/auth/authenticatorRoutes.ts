import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { parseCookies } from '../../http/cookies.js';
import { jsonBody, sendError, sendJson } from '../../http/respond.js';
import { logger } from '../../lib/logger.js';
import type { SessionUser } from '../../types.js';
import { recordAudit } from '../admin/auditLog.js';
import { findById } from '../users/users.js';
import {
  codeFailuresKey, confirmPassword, purposeError, rateLimitedReply, secondFactorOf, sendAuthenticatorChallenge, sendCurrentEmailCode,
  verifyAuthenticatorChallenge, verifyCurrentEmailCode,
} from './accountConfirmation.js';
import {
  authenticatorsAvailable, confirmAuthenticatorSetup, hasAuthenticator, removeAuthenticator, replaceRecoveryCodes, startAuthenticatorSetup,
} from './authenticators.js';
import * as ratelimit from './ratelimit.js';
import { resolveSession } from './session.js';

const log = logger.child({ component: 'auth' });

// /api/auth/authenticator/*: the logged-in person's authenticator app (modules/auth/authenticators.ts). Setting it
// up asks the password, then (with two-step login by email on) a code to that email, since the app replaces it as
// the second factor; a code from the app turns it on and hands out the recovery codes. Turning it off or asking for
// new recovery codes asks the password, then a code from the app or a recovery code.

const appSession = (request: FastifyRequest) => resolveSession(parseCookies(request.headers.cookie || '')[config.SESSION_COOKIE]);

/** Binds a code or challenge to the session that asked for it. */
const sessionScope = (sess: SessionUser) => crypto.createHash('sha256').update(`authenticator:${sess.tokenHash}`).digest('hex');

const actorOf = (sess: SessionUser) => ({ id: sess.userId, username: sess.username });

async function signedIn(request: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null> {
  const sess = await appSession(request);
  if (!sess) sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  return sess;
}

/** A new secret for the app, answered as `{ secret, uri }` (the QR code carries `uri`). */
async function beginSetup(reply: FastifyReply, user: { id: string; username: string }): Promise<void> {
  const setup = await startAuthenticatorSetup(user);
  if (setup === 'already_enabled') return sendError(reply, 409, 'authenticator_enabled', 'O app autenticador já está ativo.');
  sendJson(reply, 200, setup);
}

async function handleSetup(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await signedIn(request, reply);
  if (!sess) return;
  if (!authenticatorsAvailable()) return sendError(reply, 503, 'authenticator_unavailable', 'Este servidor não oferece app autenticador.');
  if (!(await confirmPassword(reply, sess, String(jsonBody(request.body).password ?? '')))) return;
  const user = await findById(sess.userId);
  if (!user) return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
  const factor = await secondFactorOf(user);
  if (factor === 'authenticator') return sendError(reply, 409, 'authenticator_enabled', 'O app autenticador já está ativo.');
  // the app replaces the email as the second factor, so a stolen session and password cannot swap it for theirs
  if (factor === 'email') return sendCurrentEmailCode(reply, user, 'authenticator_setup', sessionScope(sess));
  return beginSetup(reply, user);
}

async function handleSetupVerify(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await signedIn(request, reply);
  if (!sess) return;
  if (!authenticatorsAvailable()) return sendError(reply, 503, 'authenticator_unavailable', 'Este servidor não oferece app autenticador.');
  const user = await findById(sess.userId);
  if (!user) return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
  if (!(await verifyCurrentEmailCode(request, reply, { userId: user.id, email: user.email }, 'authenticator_setup', sessionScope(sess)))) return;
  return beginSetup(reply, user);
}

async function handleConfirm(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await signedIn(request, reply);
  if (!sess) return;
  const code = String(jsonBody(request.body).code ?? '').trim();
  if (!/^\d{6}$/.test(code)) return sendError(reply, 400, 'invalid_code', 'Informe o código de 6 dígitos do app.');
  const key = codeFailuresKey(sess.userId);
  const blocked = await ratelimit.checkBlocked(key);
  if (blocked) return rateLimitedReply(reply, blocked);
  const confirmed = await confirmAuthenticatorSetup(sess.userId, code);
  if (!confirmed) {
    await ratelimit.recordFailure(key);
    return purposeError(reply, 'invalid_code');
  }
  await ratelimit.reset(key).catch(() => {});
  await recordAudit({ actor: actorOf(sess), action: 'account.authenticator_enable', targetType: 'user', targetId: sess.userId, targetLabel: sess.username, requestId: request.id });
  log.info('authenticator app turned on', { userId: sess.userId });
  sendJson(reply, 200, { recoveryCodes: confirmed.recoveryCodes });
}

/** Turning the app off and replacing the recovery codes share their first step: the password, then a challenge. */
function challengeStep(purpose: 'authenticator_disable' | 'recovery_codes_reset') {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const sess = await signedIn(request, reply);
    if (!sess) return;
    if (!(await confirmPassword(reply, sess, String(jsonBody(request.body).password ?? '')))) return;
    const user = await findById(sess.userId);
    if (!user) return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
    if (!(await hasAuthenticator(user.id))) return sendError(reply, 409, 'authenticator_disabled', 'O app autenticador não está ativo.');
    return sendAuthenticatorChallenge(reply, user, purpose, sessionScope(sess));
  };
}

async function handleDisableConfirm(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await signedIn(request, reply);
  if (!sess) return;
  const via = await verifyAuthenticatorChallenge(request, reply, sess.userId, 'authenticator_disable', sessionScope(sess));
  if (!via) return;
  await db.transaction((tx) => removeAuthenticator(sess.userId, tx));
  await recordAudit({
    actor: actorOf(sess), action: 'account.authenticator_disable', targetType: 'user', targetId: sess.userId, targetLabel: sess.username,
    detail: { via }, requestId: request.id,
  });
  log.info('authenticator app turned off', { userId: sess.userId, via });
  sendJson(reply, 200, { authenticatorEnabled: false });
}

async function handleRecoveryCodesConfirm(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await signedIn(request, reply);
  if (!sess) return;
  const via = await verifyAuthenticatorChallenge(request, reply, sess.userId, 'recovery_codes_reset', sessionScope(sess));
  if (!via) return;
  const recoveryCodes = await db.transaction((tx) => replaceRecoveryCodes(sess.userId, tx));
  await recordAudit({
    actor: actorOf(sess), action: 'account.recovery_codes_reset', targetType: 'user', targetId: sess.userId, targetLabel: sess.username,
    detail: { via }, requestId: request.id,
  });
  sendJson(reply, 200, { recoveryCodes });
}

export function registerAuthenticatorRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/auth/authenticator/setup', handleSetup);
  fastify.post('/api/auth/authenticator/setup/verify', handleSetupVerify);
  fastify.post('/api/auth/authenticator/confirm', handleConfirm);
  fastify.post('/api/auth/authenticator/disable', challengeStep('authenticator_disable'));
  fastify.post('/api/auth/authenticator/disable/confirm', handleDisableConfirm);
  fastify.post('/api/auth/authenticator/recovery-codes', challengeStep('recovery_codes_reset'));
  fastify.post('/api/auth/authenticator/recovery-codes/confirm', handleRecoveryCodesConfirm);
}
