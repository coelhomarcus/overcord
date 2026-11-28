import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { base32Encode, matchTotp, otpauthUri, totpCode, totpStep } from '../../../src/modules/auth/totp.js';

// RFC 6238 appendix B (SHA-1 seed), cut to the 6 digits authenticator apps show.
const SEED = Buffer.from('12345678901234567890');
const VECTORS: [seconds: number, code: string][] = [
  [59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130'],
];

describe('totp', () => {
  it('matches the RFC 6238 test vectors', () => {
    for (const [seconds, code] of VECTORS) assert.equal(totpCode(SEED, totpStep(seconds * 1000)), code, `T=${seconds}`);
  });

  it('accepts one step either side and nothing further', () => {
    const now = 1_234_567_890_000;
    const step = totpStep(now);
    for (const offset of [-1, 0, 1]) assert.equal(matchTotp(SEED, totpCode(SEED, step + offset), now, 0), step + offset);
    for (const offset of [-2, 2]) assert.equal(matchTotp(SEED, totpCode(SEED, step + offset), now, 0), null);
  });

  it('refuses a step already used, so a seen code cannot be replayed', () => {
    const now = 1_234_567_890_000;
    const step = totpStep(now);
    const code = totpCode(SEED, step);
    assert.equal(matchTotp(SEED, code, now, step - 1), step);
    assert.equal(matchTotp(SEED, code, now, step), null);
    assert.equal(matchTotp(SEED, totpCode(SEED, step - 1), now, step), null, 'an older step neither');
  });

  it('refuses anything but six digits', () => {
    for (const code of ['', '12345', '1234567', 'abcdef', ' 287082']) assert.equal(matchTotp(SEED, code, 59_000, 0), null, code);
  });

  it('encodes the key in base32 and builds the address apps read', () => {
    assert.equal(base32Encode(SEED), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    assert.equal(base32Encode(Buffer.from('f')), 'MY');
    const uri = new URL(otpauthUri({ secret: SEED, account: 'ana souza', issuer: 'Overcord' }));
    assert.equal(uri.protocol, 'otpauth:');
    assert.equal(uri.host, 'totp');
    assert.equal(decodeURIComponent(uri.pathname), '/Overcord:ana souza');
    assert.deepEqual(Object.fromEntries(uri.searchParams), {
      secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', issuer: 'Overcord', algorithm: 'SHA1', digits: '6', period: '30',
    });
  });
});
