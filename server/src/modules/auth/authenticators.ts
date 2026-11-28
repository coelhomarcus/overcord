import crypto from 'node:crypto';
import { and, count, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { recoveryCodes, userAuthenticators } from '../../db/schema.js';
import type { Tx } from '../users/userPairLock.js';
import { openSecret, sealSecret } from './secretBox.js';
import { base32Encode, generateTotpSecret, matchTotp, otpauthUri } from './totp.js';

// An account's authenticator app and its recovery codes. Setting one up stores a sealed secret first; only a
// code from the app turns it on, and the same step hands out the recovery codes. Once on, it is the account's
// second factor instead of its email.

const ISSUER = 'Overcord';
const RECOVERY_CODE_COUNT = 10;
// no 0/o, 1/l/i: a code copied from paper must read back the same
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const RECOVERY_HALF = 5;

type Executor = Tx | typeof db;

function requireKey(): Buffer {
  const key = config.TOTP_ENCRYPTION_KEY;
  if (!key) throw new Error('TOTP_ENCRYPTION_KEY is not configured');
  return key;
}

const hashRecoveryCode = (code: string) => crypto.createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');

/** What a person typed, as it was issued: case, spaces and the dash do not matter. */
function normalizeRecoveryCode(raw: string): string {
  return raw.toLowerCase().replace(/[\s-]/g, '');
}

/** Whether `raw` has the shape of a recovery code (and so is not worth checking as an app code). */
function looksLikeRecoveryCode(raw: string): boolean {
  return new RegExp(`^[${RECOVERY_ALPHABET}]{${RECOVERY_HALF * 2}}$`).test(normalizeRecoveryCode(raw));
}

function newRecoveryCode(): string {
  const chars = Array.from({ length: RECOVERY_HALF * 2 }, () => RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)]);
  return `${chars.slice(0, RECOVERY_HALF).join('')}-${chars.slice(RECOVERY_HALF).join('')}`;
}

export interface AuthenticatorStatus { enabled: boolean; recoveryCodesLeft: number }

export async function authenticatorStatus(userId: string): Promise<AuthenticatorStatus> {
  const enabled = await hasAuthenticator(userId);
  if (!enabled) return { enabled, recoveryCodesLeft: 0 };
  const [row] = await db.select({ n: count() }).from(recoveryCodes).where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
  return { enabled, recoveryCodesLeft: row?.n ?? 0 };
}

/** Whether the account has a confirmed authenticator app. */
export async function hasAuthenticator(userId: string, executor: Executor = db): Promise<boolean> {
  const [row] = await executor.select({ userId: userAuthenticators.userId }).from(userAuthenticators)
    .where(and(eq(userAuthenticators.userId, userId), isNotNull(userAuthenticators.confirmedAt))).limit(1);
  return Boolean(row);
}

/** Starts (or restarts) a setup: a new secret, not a second factor until `confirmAuthenticatorSetup`.
 * Refused while a confirmed one exists, which has to be turned off first. */
export async function startAuthenticatorSetup(user: { id: string; username: string }): Promise<{ secret: string; uri: string } | 'already_enabled'> {
  const secret = generateTotpSecret();
  const sealed = sealSecret(requireKey(), secret, user.id);
  const [row] = await db.insert(userAuthenticators).values({ userId: user.id, secretCiphertext: sealed })
    .onConflictDoUpdate({ target: userAuthenticators.userId, set: { secretCiphertext: sealed, lastUsedStep: 0, createdAt: new Date() }, setWhere: isNull(userAuthenticators.confirmedAt) })
    .returning({ userId: userAuthenticators.userId });
  if (!row) return 'already_enabled';
  return { secret: base32Encode(secret), uri: otpauthUri({ secret, account: user.username, issuer: ISSUER }) };
}

/** Accepts a code for the account's authenticator (confirmed, or the pending setup with `pending`), and spends
 * its step. The step is written with `last_used_step < step`, so two requests with one code cannot both pass. */
async function spendCode(userId: string, code: string, { pending, executor = db, now = Date.now() }: { pending: boolean; executor?: Executor; now?: number }): Promise<boolean> {
  const [row] = await executor.select().from(userAuthenticators).where(and(
    eq(userAuthenticators.userId, userId),
    pending ? isNull(userAuthenticators.confirmedAt) : isNotNull(userAuthenticators.confirmedAt),
  )).limit(1);
  if (!row) return false;
  const step = matchTotp(openSecret(requireKey(), row.secretCiphertext, userId), code, now, row.lastUsedStep);
  if (step === null) return false;
  const [spent] = await executor.update(userAuthenticators)
    .set({ lastUsedStep: step, ...(pending ? { confirmedAt: new Date() } : {}) })
    .where(and(eq(userAuthenticators.userId, userId), lt(userAuthenticators.lastUsedStep, step)))
    .returning({ userId: userAuthenticators.userId });
  return Boolean(spent);
}

/** Turns the pending setup on with a code from the app and returns the new recovery codes, shown only now. */
export async function confirmAuthenticatorSetup(userId: string, code: string, now = Date.now()): Promise<{ recoveryCodes: string[] } | null> {
  return db.transaction(async (tx) => {
    if (!(await spendCode(userId, code, { pending: true, executor: tx, now }))) return null;
    return { recoveryCodes: await replaceRecoveryCodes(userId, tx) };
  });
}

/** A code from the confirmed app, spent so it cannot be used again. */
export function acceptAuthenticatorCode(userId: string, code: string, now = Date.now()): Promise<boolean> {
  return spendCode(userId, code, { pending: false, now });
}

/** Spends one unused recovery code. */
export async function consumeRecoveryCode(userId: string, raw: string): Promise<boolean> {
  if (!looksLikeRecoveryCode(raw)) return false;
  const [spent] = await db.update(recoveryCodes).set({ usedAt: new Date() })
    .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, hashRecoveryCode(raw)), isNull(recoveryCodes.usedAt)))
    .returning({ id: recoveryCodes.id });
  return Boolean(spent);
}

/** A code from the app or, failing that shape, a recovery code. Which one passed is returned for the trail. */
export async function acceptSecondFactorCode(userId: string, raw: string): Promise<'authenticator' | 'recovery_code' | null> {
  const code = raw.trim();
  if (/^\d{6}$/.test(code)) return (await acceptAuthenticatorCode(userId, code)) ? 'authenticator' : null;
  return (await consumeRecoveryCode(userId, code)) ? 'recovery_code' : null;
}

/** A new set of recovery codes; every earlier one stops working. */
export async function replaceRecoveryCodes(userId: string, executor: Executor = db): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  await executor.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await executor.insert(recoveryCodes).values(codes.map((code) => ({ id: crypto.randomUUID(), userId, codeHash: hashRecoveryCode(code) })));
  return codes;
}

/** Removes the app and its recovery codes. Returns whether a confirmed one was there. */
export async function removeAuthenticator(userId: string, executor: Executor = db): Promise<boolean> {
  const removed = await executor.delete(userAuthenticators).where(eq(userAuthenticators.userId, userId))
    .returning({ confirmedAt: userAuthenticators.confirmedAt });
  await executor.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  return removed.some((row) => row.confirmedAt !== null);
}
