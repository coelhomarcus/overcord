import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecuritySettings } from '@/features/settings/SecuritySettings';
import { ApiError } from '@/shared/api/api';
import type { AccountSession, SecurityStatus } from '@/shared/api/api';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';

const api = {
  fetchSecurityStatus: vi.fn(),
  fetchSessions: vi.fn(),
  setLoginAlerts: vi.fn(),
  confirmLoginAlertDisable: vi.fn(),
  requestTwoFactorEnable: vi.fn(),
  confirmTwoFactorEnable: vi.fn(),
  disableTwoFactor: vi.fn(),
  confirmTwoFactorDisable: vi.fn(),
  changePassword: vi.fn(),
  endSession: vi.fn(),
  endOtherSessions: vi.fn(),
  startAuthenticatorSetup: vi.fn(),
  verifyAuthenticatorSetupEmail: vi.fn(),
  confirmAuthenticatorSetup: vi.fn(),
  requestAuthenticatorDisable: vi.fn(),
  confirmAuthenticatorDisable: vi.fn(),
  requestRecoveryCodes: vi.fn(),
  confirmRecoveryCodes: vi.fn(),
};

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchSecurityStatus: (...args: unknown[]) => api.fetchSecurityStatus(...args),
  fetchSessions: (...args: unknown[]) => api.fetchSessions(...args),
  setLoginAlerts: (...args: unknown[]) => api.setLoginAlerts(...args),
  confirmLoginAlertDisable: (...args: unknown[]) => api.confirmLoginAlertDisable(...args),
  requestTwoFactorEnable: (...args: unknown[]) => api.requestTwoFactorEnable(...args),
  confirmTwoFactorEnable: (...args: unknown[]) => api.confirmTwoFactorEnable(...args),
  disableTwoFactor: (...args: unknown[]) => api.disableTwoFactor(...args),
  confirmTwoFactorDisable: (...args: unknown[]) => api.confirmTwoFactorDisable(...args),
  changePassword: (...args: unknown[]) => api.changePassword(...args),
  endSession: (...args: unknown[]) => api.endSession(...args),
  endOtherSessions: (...args: unknown[]) => api.endOtherSessions(...args),
  startAuthenticatorSetup: (...args: unknown[]) => api.startAuthenticatorSetup(...args),
  verifyAuthenticatorSetupEmail: (...args: unknown[]) => api.verifyAuthenticatorSetupEmail(...args),
  confirmAuthenticatorSetup: (...args: unknown[]) => api.confirmAuthenticatorSetup(...args),
  requestAuthenticatorDisable: (...args: unknown[]) => api.requestAuthenticatorDisable(...args),
  confirmAuthenticatorDisable: (...args: unknown[]) => api.confirmAuthenticatorDisable(...args),
  requestRecoveryCodes: (...args: unknown[]) => api.requestRecoveryCodes(...args),
  confirmRecoveryCodes: (...args: unknown[]) => api.confirmRecoveryCodes(...args),
}));

const status = (patch: Partial<SecurityStatus> = {}): SecurityStatus => ({
  twoFactorEnabled: false, loginAlertEnabled: true, emailDeliveryAvailable: true, hasEmail: true, sessionIdleDays: 14, ...patch,
});

const now = new Date().toISOString();
const SESSIONS: AccountSession[] = [
  { id: 'other', current: false, ip: '198.51.100.2', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0', createdAt: now, lastSeenAt: now },
  { id: 'here', current: true, ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', createdAt: now, lastSeenAt: now },
  { id: 'phone', current: false, ip: '192.0.2.9', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', createdAt: now, lastSeenAt: now },
];

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.fetchSecurityStatus.mockResolvedValue(status());
  api.fetchSessions.mockResolvedValue({ sessions: SESSIONS });
});

const switchOf = () => screen.findByRole('switch', { name: 'Código por e-mail ao entrar' });

describe('SecuritySettings: two-step verification', () => {
  it('turns on after the password and the emailed code', async () => {
    const user = userEvent.setup();
    api.requestTwoFactorEnable.mockResolvedValue({ ok: true });
    api.confirmTwoFactorEnable.mockResolvedValue({ twoFactorEnabled: true });
    render(<SecuritySettings />);

    await user.click(await switchOf());
    await user.type(screen.getByLabelText('Senha atual'), 'my password');
    await user.click(screen.getByRole('button', { name: 'Enviar código' }));
    expect(api.requestTwoFactorEnable).toHaveBeenCalledWith('my password');

    await user.type(screen.getByLabelText('Código de ativação'), '123456');
    await waitFor(() => expect(api.confirmTwoFactorEnable).toHaveBeenCalledWith('123456'));
    expect(await switchOf()).toBeChecked();
  });

  it('shows the server refusal for a wrong password and stays off', async () => {
    const user = userEvent.setup();
    api.requestTwoFactorEnable.mockRejectedValue(new ApiError(403, 'invalid_password', 'Senha incorreta.'));
    render(<SecuritySettings />);
    await user.click(await switchOf());
    await user.type(screen.getByLabelText('Senha atual'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Enviar código' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Senha incorreta.');
    expect(await switchOf()).not.toBeChecked();
  });

  it('turns off only after the password and a code sent to the account email', async () => {
    const user = userEvent.setup();
    api.fetchSecurityStatus.mockResolvedValue(status({ twoFactorEnabled: true }));
    api.disableTwoFactor.mockResolvedValue({ codeRequired: true, email: 'f***@example.com' });
    api.confirmTwoFactorDisable.mockResolvedValue({ twoFactorEnabled: false });
    render(<SecuritySettings />);
    await user.click(await switchOf());
    await user.type(screen.getByLabelText('Senha atual'), 'my password');
    await user.click(screen.getByRole('button', { name: 'Enviar código' }));
    expect(api.disableTwoFactor).toHaveBeenCalledWith('my password');
    expect(await screen.findByText(/Digite o código enviado para f\*\*\*@example\.com/)).toBeInTheDocument();
    expect(await switchOf()).toBeChecked();

    await user.type(screen.getByLabelText('Código de desativação'), '123456');
    await waitFor(() => expect(api.confirmTwoFactorDisable).toHaveBeenCalledWith('123456'));
    await waitFor(async () => expect(await switchOf()).not.toBeChecked());
  });

  it('a wrong turn-off code keeps it on and says why', async () => {
    const user = userEvent.setup();
    api.fetchSecurityStatus.mockResolvedValue(status({ twoFactorEnabled: true }));
    api.disableTwoFactor.mockResolvedValue({ codeRequired: true, email: 'f***@example.com' });
    api.confirmTwoFactorDisable.mockRejectedValue(new ApiError(400, 'invalid_code', 'Código inválido.'));
    render(<SecuritySettings />);
    await user.click(await switchOf());
    await user.type(screen.getByLabelText('Senha atual'), 'my password');
    await user.click(screen.getByRole('button', { name: 'Enviar código' }));
    await user.type(await screen.findByLabelText('Código de desativação'), '000000');
    expect(await screen.findByText('Código inválido.')).toBeInTheDocument();
    expect(await switchOf()).toBeChecked();
  });

  it('explains why it cannot be turned on without email delivery', async () => {
    api.fetchSecurityStatus.mockResolvedValue(status({ emailDeliveryAvailable: false }));
    render(<SecuritySettings />);
    expect(await switchOf()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/O envio de e-mails não está configurado neste servidor/)).toBeInTheDocument();
  });

  it('asks for an email first when the account has none', async () => {
    api.fetchSecurityStatus.mockResolvedValue(status({ hasEmail: false }));
    render(<SecuritySettings />);
    expect(await switchOf()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/Adicione um e-mail em Minha conta/)).toBeInTheDocument();
  });
});

describe('SecuritySettings: sessions', () => {
  it('lists this session first, named by browser and system, without an end button', async () => {
    render(<SecuritySettings />);
    const list = await screen.findByRole('list', { name: 'Sessões ativas' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Chrome em macOS');
    expect(rows[0]).toHaveTextContent('Esta sessão');
    expect(within(rows[0]!).queryByRole('button')).toBeNull();
    expect(rows[1]).toHaveTextContent('Edge em Windows');
    expect(rows[1]).toHaveTextContent('198.51.100.2');
    expect(rows[2]).toHaveTextContent('Safari em iOS');
    expect(screen.getByText(/sem uso por 14 dias/)).toBeInTheDocument();
  });

  it('names clients it cannot tell apart by system, or as an app or script, and keeps the raw agent in a tooltip', async () => {
    const odd = 'Mozilla/5.0 (X11; Linux x86_64) SomeEngine/1.0';
    api.fetchSessions.mockResolvedValue({
      sessions: [
        { id: 'here', current: true, ip: '203.0.113.7', userAgent: SESSIONS[1]!.userAgent, createdAt: now, lastSeenAt: now },
        { id: 'odd', current: false, ip: '198.51.100.3', userAgent: odd, createdAt: now, lastSeenAt: now },
        { id: 'script', current: false, ip: '198.51.100.4', userAgent: 'python-requests/2.31.0', createdAt: now, lastSeenAt: now },
        { id: 'blank', current: false, ip: '198.51.100.5', userAgent: '', createdAt: now, lastSeenAt: now },
      ],
    });
    render(<SecuritySettings />);
    const rows = within(await screen.findByRole('list', { name: 'Sessões ativas' })).getAllByRole('listitem');
    expect(rows[1]).toHaveTextContent('Desconhecido no Linux');
    expect(screen.getByText('Desconhecido no Linux')).toHaveAttribute('title', odd);
    expect(rows[2]).toHaveTextContent('Aplicativo ou script');
    expect(rows[3]).toHaveTextContent('Navegador desconhecido');
    expect(screen.getByText('Navegador desconhecido')).not.toHaveAttribute('title');
  });

  it('ends one session and drops it from the list', async () => {
    const user = userEvent.setup();
    api.endSession.mockResolvedValue(undefined);
    render(<SecuritySettings />);
    await user.click(await screen.findByRole('button', { name: 'Encerrar sessão: Edge em Windows' }));
    expect(api.endSession).toHaveBeenCalledWith('other');
    await waitFor(() => expect(screen.queryByText('Edge em Windows')).not.toBeInTheDocument());
    expect(screen.getByText('Safari em iOS')).toBeInTheDocument();
  });

  it('ends all the others after a confirmation', async () => {
    const user = userEvent.setup();
    api.endOtherSessions.mockResolvedValue({ endedSessions: 2 });
    render(<SecuritySettings />);
    await user.click(await screen.findByRole('button', { name: 'Encerrar todas as outras' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('2 outros navegadores serão desconectados');
    await user.click(within(dialog).getByRole('button', { name: 'Encerrar todas as outras' }));
    await waitFor(() => expect(api.endOtherSessions).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Nenhuma outra sessão ativa.')).toBeInTheDocument());
    expect(screen.getByText('Chrome em macOS')).toBeInTheDocument();
  });
});

describe('SecuritySettings: password', () => {
  it('changes the password, says how many sessions ended and reloads the list', async () => {
    const user = userEvent.setup();
    api.changePassword.mockResolvedValue({ endedSessions: 2 });
    render(<SecuritySettings />);
    await user.click(await screen.findByRole('button', { name: 'Alterar' }));
    await user.type(screen.getByLabelText('Senha atual'), 'old password');
    await user.type(screen.getByLabelText('Nova senha'), 'a new password');
    await user.click(screen.getByRole('button', { name: 'Salvar senha' }));
    expect(api.changePassword).toHaveBeenCalledWith('old password', 'a new password');
    expect(await screen.findByText('Senha alterada. 2 outras sessões foram encerradas.')).toBeInTheDocument();
    expect(api.fetchSessions).toHaveBeenCalledTimes(2);
  });

  it('refuses a short new password before calling the server', async () => {
    const user = userEvent.setup();
    render(<SecuritySettings />);
    await user.click(await screen.findByRole('button', { name: 'Alterar' }));
    await user.type(screen.getByLabelText('Senha atual'), 'old password');
    await user.type(screen.getByLabelText('Nova senha'), 'short');
    await user.click(screen.getByRole('button', { name: 'Salvar senha' }));
    expect(screen.getByRole('alert')).toHaveTextContent('pelo menos 8 caracteres');
    expect(api.changePassword).not.toHaveBeenCalled();
  });
});

describe('SecuritySettings in English', () => {
  useLanguageForTests('en-US');

  it('translates the sections and the session names', async () => {
    render(<SecuritySettings />);
    expect(await screen.findByRole('switch', { name: 'Email code at sign-in' })).toBeInTheDocument();
    expect(await screen.findByText('Chrome on macOS')).toBeInTheDocument();
    expect(screen.getByText('This session')).toBeInTheDocument();
  });
});

describe('SecuritySettings: sign-in alerts', () => {
  const alertSwitch = () => screen.findByRole('switch', { name: 'Avisar por e-mail sobre novos logins' });

  it('is on by default and turns off after the password', async () => {
    const user = userEvent.setup();
    api.setLoginAlerts.mockResolvedValue({ loginAlertEnabled: false });
    render(<SecuritySettings />);

    const toggle = await alertSwitch();
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(api.setLoginAlerts).not.toHaveBeenCalled();
    expect(toggle).toBeChecked();

    await user.type(screen.getByLabelText('Senha atual'), 'my password');
    await user.click(screen.getByRole('button', { name: 'Desativar' }));
    expect(api.setLoginAlerts).toHaveBeenCalledWith(false, 'my password');
    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  it('with two-step login on, turning off also takes the emailed code', async () => {
    const user = userEvent.setup();
    api.fetchSecurityStatus.mockResolvedValue(status({ twoFactorEnabled: true }));
    api.setLoginAlerts.mockResolvedValue({ codeRequired: true, email: 'f***@example.com' });
    api.confirmLoginAlertDisable.mockResolvedValue({ loginAlertEnabled: false });
    render(<SecuritySettings />);

    const toggle = await alertSwitch();
    await user.click(toggle);
    await user.type(screen.getByLabelText('Senha atual'), 'my password');
    await user.click(screen.getByRole('button', { name: 'Desativar' }));
    expect(await screen.findByText(/Digite o código enviado para f\*\*\*@example\.com/)).toBeInTheDocument();
    expect(toggle).toBeChecked();

    await user.type(screen.getByLabelText('Código de confirmação'), '123456');
    await waitFor(() => expect(api.confirmLoginAlertDisable).toHaveBeenCalledWith('123456'));
    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  it('a wrong password keeps them on and says why', async () => {
    const user = userEvent.setup();
    api.setLoginAlerts.mockRejectedValue(new ApiError(403, 'invalid_password', 'Senha incorreta.'));
    render(<SecuritySettings />);

    const toggle = await alertSwitch();
    await user.click(toggle);
    await user.type(screen.getByLabelText('Senha atual'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Desativar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Senha incorreta.');
    expect(toggle).toBeChecked();
  });

  it('turns back on with one click, and keeps the old state when saving fails', async () => {
    const user = userEvent.setup();
    api.fetchSecurityStatus.mockResolvedValue(status({ loginAlertEnabled: false }));
    api.setLoginAlerts.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ loginAlertEnabled: true });
    render(<SecuritySettings />);

    const toggle = await alertSwitch();
    await user.click(toggle);
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar a alteração.');
    expect(toggle).not.toBeChecked();

    await user.click(toggle);
    expect(api.setLoginAlerts).toHaveBeenLastCalledWith(true);
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it('is disabled with the reason when the account has no email or the server cannot send', async () => {
    api.fetchSecurityStatus.mockResolvedValue(status({ hasEmail: false }));
    const { unmount } = render(<SecuritySettings />);
    expect(await alertSwitch()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Cadastre um e-mail em Minha conta para receber os avisos de login.')).toBeInTheDocument();
    unmount();

    api.fetchSecurityStatus.mockResolvedValue(status({ emailDeliveryAvailable: false }));
    render(<SecuritySettings />);
    expect(await alertSwitch()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/avisos de login não podem ser enviados/)).toBeInTheDocument();
  });
});

describe('SecuritySettings: authenticator app', () => {
  const app = (patch: Partial<NonNullable<SecurityStatus['authenticator']>> = {}) => ({ available: true, enabled: false, recoveryCodesLeft: 0, ...patch });
  const CODES = Array.from({ length: 10 }, (_, i) => `abcd${i + 2}-efgh${i + 2}`);
  const SETUP = { secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', uri: 'otpauth://totp/Overcord:ana?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Overcord' };

  it('sets up with the password, a QR code and a code from the app, then shows the recovery codes once', async () => {
    const user = userEvent.setup();
    api.fetchSecurityStatus.mockResolvedValue(status({ authenticator: app() }));
    api.startAuthenticatorSetup.mockResolvedValue(SETUP);
    api.confirmAuthenticatorSetup.mockResolvedValue({ recoveryCodes: CODES });
    render(<SecuritySettings />);

    await user.click(await screen.findByRole('button', { name: 'Configurar' }));
    await user.type(screen.getByLabelText('Senha atual'), 'my password');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(api.startAuthenticatorSetup).toHaveBeenCalledWith('my password');
    expect(await screen.findByRole('img', { name: 'QR code para o app autenticador' })).toBeInTheDocument();
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Código do app'), '123456');
    await waitFor(() => expect(api.confirmAuthenticatorSetup).toHaveBeenCalledWith('123456'));
    const list = await screen.findByRole('list', { name: 'Códigos de recuperação' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    await user.click(screen.getByRole('button', { name: 'Guardei os códigos' }));
    expect(screen.queryByRole('list', { name: 'Códigos de recuperação' })).not.toBeInTheDocument();
    expect(screen.getByText(/Restam 10 códigos de recuperação/)).toBeInTheDocument();
  });

  it('asks the emailed code first when two-step login by email is on', async () => {
    const user = userEvent.setup();
    api.fetchSecurityStatus.mockResolvedValue(status({ twoFactorEnabled: true, authenticator: app() }));
    api.startAuthenticatorSetup.mockResolvedValue({ codeRequired: true, email: 'a***@example.com' });
    api.verifyAuthenticatorSetupEmail.mockResolvedValue(SETUP);
    render(<SecuritySettings />);

    await user.click(await screen.findByRole('button', { name: 'Configurar' }));
    await user.type(screen.getByLabelText('Senha atual'), 'my password');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByText(/enviamos um código para a\*\*\*@example.com/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Código do e-mail'), '246810');
    await waitFor(() => expect(api.verifyAuthenticatorSetupEmail).toHaveBeenCalledWith('246810'));
    expect(await screen.findByRole('img', { name: 'QR code para o app autenticador' })).toBeInTheDocument();
  });

  it('turns off with the password and an app or recovery code, and the email switch comes back', async () => {
    const user = userEvent.setup();
    api.fetchSecurityStatus.mockResolvedValue(status({ twoFactorEnabled: true, authenticator: app({ enabled: true, recoveryCodesLeft: 8 }) }));
    api.requestAuthenticatorDisable.mockResolvedValue({ codeRequired: true, method: 'authenticator' });
    api.confirmAuthenticatorDisable.mockResolvedValue({ authenticatorEnabled: false });
    render(<SecuritySettings />);

    expect(await switchOf()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/o login não usa mais o código por e-mail/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desativar' }));
    await user.type(screen.getByLabelText('Senha atual'), 'my password');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.type(await screen.findByLabelText('Código do app ou de recuperação'), 'abcde-fghjk');
    await user.click(screen.getAllByRole('button', { name: 'Desativar' }).at(-1)!);
    await waitFor(() => expect(api.confirmAuthenticatorDisable).toHaveBeenCalledWith('abcde-fghjk'));
    expect(await screen.findByRole('button', { name: 'Configurar' })).toBeInTheDocument();
    await waitFor(async () => expect(await switchOf()).not.toHaveAttribute('aria-disabled', 'true'));
  });

  it('warns when few recovery codes are left and hides itself on a server without it', async () => {
    api.fetchSecurityStatus.mockResolvedValue(status({ authenticator: app({ enabled: true, recoveryCodesLeft: 1 }) }));
    const first = render(<SecuritySettings />);
    expect(await screen.findByText(/Resta só 1 código de recuperação/)).toBeInTheDocument();
    first.unmount();

    api.fetchSecurityStatus.mockResolvedValue(status());
    render(<SecuritySettings />);
    await switchOf();
    expect(screen.queryByRole('button', { name: 'Configurar' })).not.toBeInTheDocument();
  });
});
