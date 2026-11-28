import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Input } from '@/shared/ui/primitives/input';
import { Textarea } from '@/shared/ui/primitives/textarea';
import { REASON_MAX, REASON_MIN, describeAdminError, normalizeReasonText } from './adminErrors';
import type { SecondFactorRequested } from './adminApi';

type ReasonDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  /** when set, the admin must type exactly this (case-insensitive) to proceed */
  confirmText?: string;
} & ({
  onSubmit: (reason: string, confirm: string) => Promise<void>;
  verification?: never;
} | {
  onSubmit?: never;
  verification: {
    requestCode: (reason: string, password: string) => Promise<SecondFactorRequested>;
    onConfirm: (reason: string, code: string, confirm: string) => Promise<void>;
  };
});

/** Every restrictive or destructive admin action asks for a written reason
 * (§7.5), optionally a typed confirmation, and closes once the server answers. */
export function ReasonDialog({ open, onOpenChange, title, description, confirmLabel, destructive, confirmText, verification, onSubmit }: ReasonDialogProps) {
  const { t } = useTranslation('admin');
  const deliveryHintId = useId();
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  // set once the password earned the second step: where its code comes from
  const [delivery, setDelivery] = useState<SecondFactorRequested | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedReason = normalizeReasonText(reason);
  const reasonOk = normalizedReason.length >= REASON_MIN && normalizedReason.length <= REASON_MAX;
  const confirmOk = !confirmText || confirm.trim().toLowerCase() === confirmText.toLowerCase();
  const credentialsOk = !verification || (delivery ? /^\d{6}$/.test(code) : password.length > 0);

  function resetVerification() {
    setPassword('');
    setCode('');
    setDelivery(null);
    setError(null);
  }

  function finish() {
    onOpenChange(false);
    setReason('');
    setConfirm('');
    resetVerification();
  }

  function close() {
    if (!busy) finish();
  }

  async function submit() {
    if (!reasonOk || !confirmOk || !credentialsOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (verification && !delivery) {
        setDelivery(await verification.requestCode(normalizedReason, password));
        setPassword('');
        return;
      }
      if (verification) await verification.onConfirm(normalizedReason, code, confirm.trim());
      else await onSubmit(normalizedReason, confirm.trim());
      finish();
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent showCloseButton={!busy} className="max-w-[calc(100%-2rem)] gap-0 bg-bg-modal p-0 shadow-popover sm:max-w-md">
        <DialogHeader className="border-b border-border-divider px-6 py-5 pr-12">
          <DialogTitle className="text-title font-bold text-text-strong">{title}</DialogTitle>
          <DialogDescription className="text-label text-text-secondary">{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="flex flex-col gap-3 px-6 py-4">
            {delivery ? (
              <>
                <p id={deliveryHintId} className="text-label text-text-secondary">{delivery.method === 'authenticator' ? t('dialog.authenticatorPrompt') : t('dialog.codeSent', { email: delivery.email })}</p>
                <label className="flex flex-col gap-1.5 text-label text-text-muted">
                  {t('dialog.verificationCode')}
                  <Input autoFocus inputMode="numeric" autoComplete="one-time-code" aria-describedby={deliveryHintId} value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} disabled={busy} className="border-border bg-fill-subtle" />
                </label>
              </>
            ) : (
              <>
                <label className="flex flex-col gap-1.5 text-label text-text-muted">
                  {t('dialog.reasonLabel')}
                  <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={REASON_MAX} rows={3} disabled={busy} className="resize-none border-border bg-fill-subtle" />
                </label>
                {confirmText && (
                  <label className="flex flex-col gap-1.5 text-label text-text-muted">
                    <span>{t('dialog.confirmPrompt')} <span className="font-medium text-text-primary">{confirmText}</span></span>
                    <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} className="border-border bg-fill-subtle" />
                  </label>
                )}
                {verification && (
                  <label className="flex flex-col gap-1.5 text-label text-text-muted">
                    {t('dialog.currentPassword')}
                    <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} className="border-border bg-fill-subtle" />
                  </label>
                )}
              </>
            )}
            {error && <p role="alert" className="text-label text-red-text">{error}</p>}
          </div>
          <DialogFooter className="border-t border-border-divider bg-surface-raised px-6 py-4">
            <Button type="button" variant="ghost" disabled={busy} onClick={close}>{t('dialog.cancel')}</Button>
            {/* an emailed code can be replaced; the app shows a new one by itself */}
            {delivery && delivery.method !== 'authenticator' && <Button type="button" variant="secondary" disabled={busy} onClick={resetVerification}>{t('dialog.newCode')}</Button>}
            <Button type="submit" variant={destructive && (!verification || delivery) ? 'destructive' : 'default'} disabled={!reasonOk || !confirmOk || !credentialsOk || busy}>
              {busy ? t('dialog.wait') : verification && !delivery ? t('dialog.sendCode') : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
