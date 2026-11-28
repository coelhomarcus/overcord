import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminLogin } from '@/features/admin/AdminLogin';
import * as session from '@/features/admin/adminSessionApi';
import { ApiError } from '@/shared/api/transport';

vi.mock('@/features/admin/adminSessionApi');
const mocked = vi.mocked(session);

const IDENTITY = { id: 'u1', username: 'ana', locale: 'pt-BR', avatar: '', avatarColor: '' } as session.AdminIdentity;
const CHALLENGE = { challenge: 'c'.repeat(43), method: 'authenticator' as const };

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Nome de usuário'), 'ana');
  await user.type(screen.getByLabelText('Senha', { exact: true }), 'secret password');
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
}

beforeEach(() => { vi.clearAllMocks(); });

describe('AdminLogin', () => {
  it('asks for the authenticator app code after the password, never offering an email resend', async () => {
    const user = userEvent.setup();
    const onSignedIn = vi.fn();
    mocked.loginAdmin.mockResolvedValue({ twoFactor: CHALLENGE });
    mocked.verifyAdminCode.mockResolvedValue({ user: IDENTITY });
    render(<AdminLogin onSignedIn={onSignedIn} notice={null} />);
    await signIn(user);

    expect(await screen.findByText(/Abra seu app autenticador/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reenviar código' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Código de verificação'), '135790');
    await waitFor(() => expect(mocked.verifyAdminCode).toHaveBeenCalledWith(CHALLENGE.challenge, '135790'));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(IDENTITY));
  });

  it('takes a recovery code when the phone is not at hand', async () => {
    const user = userEvent.setup();
    mocked.loginAdmin.mockResolvedValue({ twoFactor: CHALLENGE });
    mocked.verifyAdminCode.mockResolvedValue({ user: IDENTITY });
    render(<AdminLogin onSignedIn={vi.fn()} notice={null} />);
    await signIn(user);
    await user.click(await screen.findByRole('button', { name: 'Usar um código de recuperação' }));
    await user.type(screen.getByLabelText('Código de recuperação'), 'abcde-fghjk');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(mocked.verifyAdminCode).toHaveBeenCalledWith(CHALLENGE.challenge, 'abcde-fghjk'));
  });

  it('explains that an admin needs an authenticator app first', async () => {
    const user = userEvent.setup();
    mocked.loginAdmin.mockRejectedValue(new ApiError(403, 'admin_authenticator_required', 'x'));
    render(<AdminLogin onSignedIn={vi.fn()} notice={null} />);
    await signIn(user);
    expect(await screen.findByText('Ative o app autenticador em Configurações → Segurança no Overcord.')).toBeInTheDocument();
  });
});
