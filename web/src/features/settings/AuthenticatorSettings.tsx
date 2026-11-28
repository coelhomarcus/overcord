import { CheckIcon, CircleNotchIcon, DownloadSimpleIcon, KeyIcon } from '@/shared/ui/icons';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { encode } from 'uqr';

import {
  confirmAuthenticatorDisable, confirmAuthenticatorSetup, confirmRecoveryCodes, requestAuthenticatorDisable, requestRecoveryCodes,
  startAuthenticatorSetup, verifyAuthenticatorSetupEmail,
} from '@/shared/api/api';
import type { AuthenticatorSetup, SecurityStatus } from '@/shared/api/api';
import { describeApiError } from '@/shared/api/errorText';
import { CopyLabel, CopyStatusIcon } from '@/shared/CopyFeedback';
import { useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard';
import { OTPInput, type OTPStatus } from '@/shared/ui/motion/otp-input';
import { Button } from '@/shared/ui/primitives/button';
import { Input } from '@/shared/ui/primitives/input';
import { Label } from '@/shared/ui/primitives/label';
import { SETTINGS_INLINE_PANEL, SettingsNotice, SettingsRow } from '@/shared/ui/settings-layout';

type Flow = 'setup' | 'disable' | 'recovery';
type Phase =
  | { step: 'idle' }
  | { step: 'password'; flow: Flow }
  | { step: 'email'; email: string }
  | { step: 'scan'; setup: AuthenticatorSetup }
  | { step: 'code'; flow: 'disable' | 'recovery' }
  | { step: 'codes'; codes: string[] };

type Authenticator = NonNullable<SecurityStatus['authenticator']>;

/** An authenticator app as the account's second factor (Microsoft or Google Authenticator, 1Password…). Setting
 * it up asks the password (and, with two-step login by email on, a code to that email), shows a QR code, and takes
 * a code from the app; the recovery codes are shown once, then. Turning it off or replacing the recovery codes asks
 * the password and a code from the app or a recovery code. */
export function AuthenticatorSettings({ status, onChange }: { status: Authenticator; onChange: (next: Authenticator) => void }) {
  const { t } = useTranslation('settings');
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [otpStatus, setOtpStatus] = useState<OTPStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // typing the 6th digit and clicking the button can both submit before `pending` renders
  const submittingRef = useRef(false);

  function reset() {
    setPhase({ step: 'idle' });
    setPassword('');
    setCode('');
    setOtpStatus('idle');
    setError(null);
  }

  function start(flow: Flow) {
    reset();
    setPhase({ step: 'password', flow });
  }

  async function run(action: () => Promise<void>, fallbackKey: string) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setPending(true);
    try {
      await action();
    } catch (err) {
      setOtpStatus('error');
      setError(describeApiError(err, fallbackKey));
    } finally {
      setPending(false);
      submittingRef.current = false;
    }
  }

  function submitPassword(event: FormEvent, flow: Flow) {
    event.preventDefault();
    void run(async () => {
      if (flow === 'setup') {
        const result = await startAuthenticatorSetup(password);
        setPhase('codeRequired' in result ? { step: 'email', email: result.email } : { step: 'scan', setup: result });
      } else {
        await (flow === 'disable' ? requestAuthenticatorDisable(password) : requestRecoveryCodes(password));
        setPhase({ step: 'code', flow });
      }
      setPassword('');
      setCode('');
    }, 'settings:security.authenticator.failed');
  }

  function submitEmailCode(next = code) {
    if (next.length !== 6) return;
    void run(async () => {
      setPhase({ step: 'scan', setup: await verifyAuthenticatorSetupEmail(next) });
      setCode('');
      setOtpStatus('idle');
    }, 'settings:security.authenticator.failed');
  }

  function submitAppCode(next = code) {
    if (next.length !== 6) return;
    void run(async () => {
      const { recoveryCodes } = await confirmAuthenticatorSetup(next);
      onChange({ ...status, enabled: true, recoveryCodesLeft: recoveryCodes.length });
      setCode('');
      setPhase({ step: 'codes', codes: recoveryCodes });
    }, 'settings:security.authenticator.confirmFailed');
  }

  function submitChallenge(event: FormEvent, flow: 'disable' | 'recovery') {
    event.preventDefault();
    const typed = code.trim();
    if (!typed) return;
    void run(async () => {
      if (flow === 'disable') {
        await confirmAuthenticatorDisable(typed);
        onChange({ ...status, enabled: false, recoveryCodesLeft: 0 });
        reset();
      } else {
        const { recoveryCodes } = await confirmRecoveryCodes(typed);
        onChange({ ...status, recoveryCodesLeft: recoveryCodes.length });
        setCode('');
        setPhase({ step: 'codes', codes: recoveryCodes });
      }
    }, 'settings:security.authenticator.failed');
  }

  const busy = phase.step !== 'idle';

  return (
    <div className="flex flex-col gap-4">
      <SettingsRow
        label={t('security.authenticator.label')}
        description={status.enabled
          ? t('security.authenticator.descriptionOn', { count: status.recoveryCodesLeft })
          : t('security.authenticator.descriptionOff')}
        disabled={!status.available && !status.enabled}
      >
        {status.enabled ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={busy || pending} onClick={() => start('recovery')}>
              {t('security.authenticator.newRecoveryCodes')}
            </Button>
            <Button type="button" size="sm" variant="danger-outline" disabled={busy || pending} onClick={() => start('disable')}>
              {t('security.authenticator.disable')}
            </Button>
          </div>
        ) : (
          <Button type="button" size="sm" disabled={!status.available || busy || pending} onClick={() => start('setup')}>
            {t('security.authenticator.setUp')}
          </Button>
        )}
      </SettingsRow>
      {!status.available && !status.enabled && <SettingsNotice tone="info">{t('security.authenticator.unavailable')}</SettingsNotice>}
      {status.enabled && status.recoveryCodesLeft <= 2 && phase.step === 'idle' && (
        <SettingsNotice tone="warning">{t('security.authenticator.fewRecoveryCodes', { count: status.recoveryCodesLeft })}</SettingsNotice>
      )}

      {phase.step === 'password' && (
        <form onSubmit={(event) => submitPassword(event, phase.flow)} className={`flex flex-col gap-3 ${SETTINGS_INLINE_PANEL}`}>
          <p className="text-label text-text-muted">{t(`security.authenticator.passwordHint.${phase.flow}`)}</p>
          <div>
            <Label htmlFor="authenticatorPassword" className="text-label text-text-muted">{t('security.authenticator.password')}</Label>
            <Input id="authenticatorPassword" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} />
          </div>
          {error && <p role="alert" className="text-label text-red-text">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={pending || !password}>
              {pending && <CircleNotchIcon size={20} className="animate-spin" />}
              <span>{t('security.authenticator.continue')}</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={reset}>{t('security.cancel')}</Button>
          </div>
        </form>
      )}

      {phase.step === 'email' && (
        <div className={`flex flex-col gap-3 ${SETTINGS_INLINE_PANEL}`}>
          <p className="text-label text-text-muted">{t('security.authenticator.emailCodeSent', { email: phase.email })}</p>
          <OTPInput
            label={t('security.authenticator.emailCodeLabel')}
            hint={t('security.twoFactor.codeHint')}
            errorMessage={error ?? t('security.twoFactor.codeError')}
            value={code}
            status={otpStatus}
            disabled={pending}
            autoFocus
            onChange={(value) => { setCode(value); setOtpStatus('idle'); setError(null); }}
            onComplete={submitEmailCode}
            aria-label={t('security.authenticator.emailCodeLabel')}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={pending || code.length !== 6} onClick={() => submitEmailCode()}>{t('security.authenticator.continue')}</Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={reset}>{t('security.cancel')}</Button>
          </div>
        </div>
      )}

      {phase.step === 'scan' && (
        <div className={`flex flex-col gap-4 ${SETTINGS_INLINE_PANEL}`}>
          <p className="text-label text-text-muted">{t('security.authenticator.scanHint')}</p>
          <div className="flex flex-wrap items-center gap-4">
            <QrCode value={phase.setup.uri} label={t('security.authenticator.qrLabel')} />
            <ManualKey secret={phase.setup.secret} />
          </div>
          <OTPInput
            label={t('security.authenticator.appCodeLabel')}
            hint={t('security.authenticator.appCodeHint')}
            errorMessage={error ?? t('security.twoFactor.codeError')}
            value={code}
            status={otpStatus}
            disabled={pending}
            onChange={(value) => { setCode(value); setOtpStatus('idle'); setError(null); }}
            onComplete={submitAppCode}
            aria-label={t('security.authenticator.appCodeLabel')}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={pending || code.length !== 6} onClick={() => submitAppCode()}>
              {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : <CheckIcon size={20} weight="fill" />}
              <span>{t('security.authenticator.turnOn')}</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={reset}>{t('security.cancel')}</Button>
          </div>
        </div>
      )}

      {phase.step === 'code' && (
        <form onSubmit={(event) => submitChallenge(event, phase.flow)} className={`flex flex-col gap-3 ${SETTINGS_INLINE_PANEL}`}>
          <p className="text-label text-text-muted">{t('security.authenticator.challengeHint')}</p>
          <div>
            <Label htmlFor="authenticatorChallenge" className="text-label text-text-muted">{t('security.authenticator.challengeLabel')}</Label>
            <Input id="authenticatorChallenge" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} autoFocus value={code} onChange={(e) => { setCode(e.target.value); setError(null); }} />
          </div>
          {error && <p role="alert" className="text-label text-red-text">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" variant={phase.flow === 'disable' ? 'destructive' : 'default'} disabled={pending || !code.trim()}>
              {pending && <CircleNotchIcon size={20} className="animate-spin" />}
              <span>{phase.flow === 'disable' ? t('security.authenticator.disable') : t('security.authenticator.newRecoveryCodes')}</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={reset}>{t('security.cancel')}</Button>
          </div>
        </form>
      )}

      {phase.step === 'codes' && <RecoveryCodes codes={phase.codes} onDone={reset} />}
    </div>
  );
}

/** Black on white whatever the theme: that is what phone cameras read reliably. */
function QrCode({ value, label }: { value: string; label: string }) {
  const { data, size } = encode(value, { border: 2 });
  let path = '';
  data.forEach((row, y) => row.forEach((dark, x) => { if (dark) path += `M${x} ${y}h1v1h-1z`; }));
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges" className="size-44 flex-none rounded-lg">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

/** The key for apps that cannot scan, in groups of four as apps show it. */
function ManualKey({ secret }: { secret: string }) {
  const { t } = useTranslation('settings');
  const { copied, copy } = useCopyToClipboard();
  return (
    <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1.5">
      <span className="text-caption font-medium text-text-muted">{t('security.authenticator.manualKey')}</span>
      <code className="select-text break-all font-mono text-label text-text-primary">{secret.match(/.{1,4}/g)?.join(' ')}</code>
      <Button type="button" size="sm" variant="secondary" className="self-start" onClick={() => void copy(secret)}>
        <CopyStatusIcon copied={copied} size={16} />
        <CopyLabel copied={copied}>{t('security.authenticator.copyKey')}</CopyLabel>
      </Button>
    </div>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation('settings');
  const { copied, copy } = useCopyToClipboard();
  const text = codes.join('\n');

  function download() {
    const url = URL.createObjectURL(new Blob([`${t('security.authenticator.fileHeading')}\n\n${text}\n`], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'overcord-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={`flex flex-col gap-3 ${SETTINGS_INLINE_PANEL}`}>
      <p className="flex items-center gap-2 text-body font-semibold text-text-strong">
        <KeyIcon size={20} weight="fill" aria-hidden />
        {t('security.authenticator.codesTitle')}
      </p>
      <p className="text-label text-text-muted">{t('security.authenticator.codesHint')}</p>
      <ul aria-label={t('security.authenticator.codesTitle')} className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md border border-border bg-surface-app p-3 font-mono text-label text-text-primary sm:grid-cols-[repeat(2,max-content)]">
        {codes.map((code) => <li key={code} className="select-text">{code}</li>)}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => void copy(text)}>
          <CopyStatusIcon copied={copied} size={16} />
          <CopyLabel copied={copied}>{t('security.authenticator.copyCodes')}</CopyLabel>
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={download}>
          <DownloadSimpleIcon size={16} />
          <span>{t('security.authenticator.downloadCodes')}</span>
        </Button>
        <Button type="button" size="sm" onClick={onDone}>{t('security.authenticator.savedCodes')}</Button>
      </div>
    </div>
  );
}
