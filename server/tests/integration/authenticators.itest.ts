import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { config } from '../../src/config/env.js';
import { recoveryCodes, userAuthenticators } from '../../src/db/schema.js';
import {
  acceptAuthenticatorCode, acceptSecondFactorCode, authenticatorStatus, confirmAuthenticatorSetup, consumeRecoveryCode,
  hasAuthenticator, removeAuthenticator, replaceRecoveryCodes, startAuthenticatorSetup,
} from '../../src/modules/auth/authenticators.js';
import { openSecret } from '../../src/modules/auth/secretBox.js';
import { totpCode, totpStep } from '../../src/modules/auth/totp.js';
import { db, makeUser, pool } from './helpers.js';

// An account's authenticator app against the real database: the setup a code confirms, codes that work once
// (in a race too) and recovery codes.

after(async () => { await pool.end(); });

/** The code the account's app would show at `now`, read back from the sealed secret. */
async function appCode(userId: string, now = Date.now()): Promise<string> {
  const [row] = await db.select().from(userAuthenticators).where(eq(userAuthenticators.userId, userId));
  assert.ok(row && config.TOTP_ENCRYPTION_KEY);
  return totpCode(openSecret(config.TOTP_ENCRYPTION_KEY, row.secretCiphertext, userId), totpStep(now));
}

async function enrolled() {
  const user = await makeUser('totp', 'user', false);
  const setup = await startAuthenticatorSetup(user);
  assert.notEqual(setup, 'already_enabled');
  // a step back, so the test's own code below is a newer one
  const confirmed = await confirmAuthenticatorSetup(user.id, await appCode(user.id, Date.now() - 30_000));
  assert.ok(confirmed);
  return { user, recovery: confirmed.recoveryCodes };
}

describe('authenticator apps', () => {
  it('is not a second factor until a code from the app confirms the setup', async () => {
    const user = await makeUser('totp', 'user', false);
    const setup = await startAuthenticatorSetup(user);
    assert.ok(setup !== 'already_enabled');
    assert.match(setup.secret, /^[A-Z2-7]{32}$/);
    assert.match(setup.uri, /^otpauth:\/\/totp\/Overcord:totp_/);
    assert.equal(await hasAuthenticator(user.id), false);
    assert.equal(await acceptAuthenticatorCode(user.id, await appCode(user.id)), false, 'a pending app signs nothing in');

    assert.equal(await confirmAuthenticatorSetup(user.id, '000000'), null);
    const confirmed = await confirmAuthenticatorSetup(user.id, await appCode(user.id));
    assert.equal(confirmed?.recoveryCodes.length, 10);
    for (const code of confirmed!.recoveryCodes) assert.match(code, /^[a-z2-9]{5}-[a-z2-9]{5}$/);
    assert.equal(await hasAuthenticator(user.id), true);
    assert.deepEqual(await authenticatorStatus(user.id), { enabled: true, recoveryCodesLeft: 10 });
    assert.equal(await startAuthenticatorSetup(user), 'already_enabled', 'a working app is turned off first');
  });

  it('accepts each code once, even when two requests race with it', async () => {
    const { user } = await enrolled();
    const code = await appCode(user.id);
    const results = await Promise.all([acceptAuthenticatorCode(user.id, code), acceptAuthenticatorCode(user.id, code)]);
    assert.deepEqual(results.sort(), [false, true]);
    assert.equal(await acceptAuthenticatorCode(user.id, code), false);
  });

  it('spends recovery codes once, in any case and with or without the dash', async () => {
    const { user, recovery } = await enrolled();
    assert.equal(await consumeRecoveryCode(user.id, ` ${recovery[0]!.toUpperCase().replace('-', '')} `), true);
    assert.equal(await consumeRecoveryCode(user.id, recovery[0]!), false);
    assert.equal(await acceptSecondFactorCode(user.id, recovery[1]!), 'recovery_code');
    assert.equal(await acceptSecondFactorCode(user.id, await appCode(user.id)), 'authenticator');
    assert.equal(await acceptSecondFactorCode(user.id, 'not-a-code'), null);
    assert.equal((await authenticatorStatus(user.id)).recoveryCodesLeft, 8);

    const fresh = await replaceRecoveryCodes(user.id);
    assert.equal(await consumeRecoveryCode(user.id, recovery[2]!), false, 'a new set ends the old one');
    assert.equal(await consumeRecoveryCode(user.id, fresh[0]!), true);
  });

  it('removing the app removes its recovery codes', async () => {
    const { user, recovery } = await enrolled();
    assert.equal(await removeAuthenticator(user.id), true);
    assert.equal(await hasAuthenticator(user.id), false);
    assert.equal(await consumeRecoveryCode(user.id, recovery[0]!), false);
    assert.equal((await db.select().from(recoveryCodes).where(eq(recoveryCodes.userId, user.id))).length, 0);
    assert.equal(await removeAuthenticator(user.id), false);
  });
});
