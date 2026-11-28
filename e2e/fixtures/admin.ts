import { ADMIN_URL, emailCount, waitForEmailCode } from '../stack/stack';
import { expect, type User } from './test';
import { appCode, rememberAuthenticator } from './totp';

const emailOf = (user: User) => `${user.username}@example.test`;

/** Sets up an authenticator app (what the panel signs in with) and returns the recovery codes it handed out. */
export async function enableAuthenticator(user: User): Promise<string[]> {
  const email = emailOf(user);
  const seen = await emailCount(email);
  const setup = await user.api.post('/api/auth/authenticator/setup', { data: { password: user.password } });
  expect(setup.ok(), await setup.text()).toBe(true);
  let body = await setup.json() as { secret?: string; codeRequired?: true };
  if (body.codeRequired) {
    // two-step login by email is on: that address confirms the switch first
    const verify = await user.api.post('/api/auth/authenticator/setup/verify', { data: { code: await waitForEmailCode(email, seen) } });
    expect(verify.ok(), await verify.text()).toBe(true);
    body = await verify.json() as { secret: string };
  }
  rememberAuthenticator(user.username, body.secret!);
  const confirm = await user.api.post('/api/auth/authenticator/confirm', { data: { code: await appCode(user.username) } });
  expect(confirm.ok(), await confirm.text()).toBe(true);
  return (await confirm.json() as { recoveryCodes: string[] }).recoveryCodes;
}

export async function signInAdminThroughApi(user: User) {
  const headers = { origin: ADMIN_URL };
  const login = await user.api.post(`${ADMIN_URL}/api/admin/auth/login`, { headers, data: { username: user.username, password: user.password } });
  expect(login.ok(), await login.text()).toBe(true);
  const { twoFactor } = await login.json() as { twoFactor: { challenge: string } };
  const verify = await user.api.post(`${ADMIN_URL}/api/admin/auth/login/verify`, {
    headers, data: { challenge: twoFactor.challenge, code: await appCode(user.username) },
  });
  expect(verify.ok(), await verify.text()).toBe(true);
}

export const ADMIN_CALL_METRICS_URL = `${ADMIN_URL}/api/admin/call-metrics`;

export async function readAdminCallMetrics(user: User) {
  const response = await user.api.get(ADMIN_CALL_METRICS_URL);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<{
    current: { calls: number; accountsInCall: number; onlineAccounts: number; at: string; screens: { count: number; at: string; stale: boolean } | null };
    timeZone: string;
    history: { day: string; calls: number | null; screens: number | null }[];
  }>;
}
