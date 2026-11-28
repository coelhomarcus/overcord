import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import * as adminApi from '@/features/admin/adminApi';
import { clearAdminResources, useAdminSystem } from '@/features/admin/adminResources';

vi.mock('@/features/admin/adminApi');
const api = vi.mocked(adminApi);

function Accounts() {
  const { data, status } = useAdminSystem();
  return <p>{data ? `accounts ${data.info.accounts.total}` : status}</p>;
}

const system = (total: number) => ({ accounts: { total } }) as adminApi.SystemInfo;

beforeEach(() => {
  vi.resetAllMocks();
  clearAdminResources();
});

it('reads again when a sign-in clears the resource under a view that stays mounted', async () => {
  let answer!: (value: adminApi.SystemInfo) => void;
  api.fetchSystem.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
  api.fetchSystem.mockResolvedValueOnce(system(4));
  render(<Accounts />);
  expect(screen.getByText('loading')).toBeInTheDocument();
  // what a second sign-in does: the read in flight is aborted and never answers the view
  act(() => clearAdminResources());
  expect(await screen.findByText('accounts 4')).toBeInTheDocument();
  expect(api.fetchSystem).toHaveBeenCalledTimes(2);
  answer(system(1));
});
