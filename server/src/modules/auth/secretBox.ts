import crypto from 'node:crypto';

// Seals small secrets (an authenticator app's key) with AES-256-GCM under TOTP_ENCRYPTION_KEY. The key lives in
// the environment, never in the database, so a stolen database or backup alone cannot mint codes. `context`
// (the account id) is authenticated with the ciphertext, so a sealed value copied to another row fails to open.

const VERSION = 'v1';
const IV_BYTES = 12;

export function sealSecret(key: Buffer, plain: Buffer, context: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const sealed = Buffer.concat([cipher.update(plain), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), sealed.toString('base64url')].join(':');
}

/** Throws when the value was not sealed with this key and context, or was changed. */
export function openSecret(key: Buffer, sealed: string, context: string): Buffer {
  const [version, iv, tag, body] = sealed.split(':');
  if (version !== VERSION || !iv || !tag || body === undefined) throw new Error('unknown sealed secret format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]);
}
