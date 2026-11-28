import crypto from 'node:crypto';

// A stand-in for an authenticator app in the specs (RFC 6238 with Overcord's parameters: SHA-1, 6 digits, 30 s).
// The server takes each step once, so codes for one account come from successive steps: when the spec has already
// used the newest one the server still accepts, this waits for the next.

const STEP_MS = 30_000;
const apps = new Map<string, { key: Buffer; lastStep: number }>();

function base32Decode(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.replace(/\s/g, '').toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function codeAt(key: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** Keeps the key a setup showed, as scanning the QR code would. */
export function rememberAuthenticator(username: string, secret: string): void {
  apps.set(username, { key: base32Decode(secret), lastStep: 0 });
}

/** The next code the account's app shows that the server has not seen yet. */
export async function appCode(username: string): Promise<string> {
  const app = apps.get(username);
  if (!app) throw new Error(`no authenticator app set up for ${username}`);
  let step = Math.max(Math.floor(Date.now() / STEP_MS), app.lastStep + 1);
  // the server accepts one step ahead of its clock at most
  while (step > Math.floor(Date.now() / STEP_MS) + 1) await new Promise((resolve) => setTimeout(resolve, 1000));
  step = Math.max(step, Math.floor(Date.now() / STEP_MS));
  app.lastStep = step;
  return codeAt(app.key, step);
}
