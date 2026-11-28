import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { openSecret, sealSecret } from '../../../src/modules/auth/secretBox.js';

const key = crypto.randomBytes(32);
const secret = Buffer.from('12345678901234567890');

describe('secretBox', () => {
  it('opens what it sealed, with a fresh nonce each time', () => {
    const sealed = sealSecret(key, secret, 'user-1');
    assert.match(sealed, /^v1:[\w-]+:[\w-]+:[\w-]+$/);
    assert.deepEqual(openSecret(key, sealed, 'user-1'), secret);
    assert.notEqual(sealSecret(key, secret, 'user-1'), sealed);
  });

  it('refuses another key, another account or a changed value', () => {
    const sealed = sealSecret(key, secret, 'user-1');
    assert.throws(() => openSecret(crypto.randomBytes(32), sealed, 'user-1'));
    assert.throws(() => openSecret(key, sealed, 'user-2'), Error, 'copied to another row');
    const [version, iv, tag, body] = sealed.split(':');
    const flipped = Buffer.from(body!, 'base64url');
    flipped[0]! ^= 1;
    assert.throws(() => openSecret(key, [version, iv, tag, flipped.toString('base64url')].join(':'), 'user-1'));
    assert.throws(() => openSecret(key, 'v2:a:b:c', 'user-1'));
  });
});
