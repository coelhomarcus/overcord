import crypto from 'node:crypto';

// Time-based one-time codes (RFC 6238) for authenticator apps. HMAC-SHA-1, 6 digits and 30-second steps
// are the only parameters Microsoft Authenticator accepts, and every other app reads them too. Pure: no
// database, so the codes and their window are testable on their own (authenticators.ts stores the rest).

const STEP_SECONDS = 30;
const DIGITS = 6;
// One step either side: a phone clock a little off, or a code typed as it rolled over.
const WINDOW_STEPS = 1;
const SECRET_BYTES = 20;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A new secret for an authenticator app (160 bits, the RFC 4226 recommendation). */
export function generateTotpSecret(): Buffer {
  return crypto.randomBytes(SECRET_BYTES);
}

/** RFC 4648 base32 without padding, the form authenticator apps take a key in. */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** The step a moment falls in. */
export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

/** The code of one step (RFC 4226's HOTP with the step as its counter). */
export function totpCode(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(binary).padStart(DIGITS, '0');
}

/** The step `code` belongs to, if it is right for a step near `nowMs` that is newer than `lastUsedStep`;
 * null otherwise. Refusing a step already used is what keeps a code someone saw from being replayed. */
export function matchTotp(secret: Buffer, code: string, nowMs: number, lastUsedStep: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(nowMs);
  let matched: number | null = null;
  // every candidate is compared, so the time taken does not tell which step matched
  for (let step = current - WINDOW_STEPS; step <= current + WINDOW_STEPS; step++) {
    const expected = Buffer.from(totpCode(secret, step));
    if (crypto.timingSafeEqual(expected, Buffer.from(code)) && step > lastUsedStep && matched === null) matched = step;
  }
  return matched;
}

/** The `otpauth://` address a QR code carries into an authenticator app. */
export function otpauthUri({ secret, account, issuer }: { secret: Buffer; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: base32Encode(secret), issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
