import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';
import { CopyIdButton } from './CopyIdButton';

/** Who or what an admin detail page is about: an avatar, a name, a secondary
 * line, the badges that say its state, and the id — copyable, and breakable so
 * a long one never widens the page. */
export function AdminEntityHeader({ avatar, square, title, subtitle, id, badges }: {
  avatar: ReactNode;
  /** the picture is a server's squircle, not a person's circle */
  square?: boolean;
  title: string;
  subtitle?: string;
  id: string;
  badges?: ReactNode;
}) {
  const { t } = useTranslation('admin');
  return (
    <header className="admin-panel overflow-hidden">
      {/* a wash of the accent across the top, so a detail page reads as a profile at a glance */}
      <div aria-hidden className="h-20 bg-[linear-gradient(120deg,rgb(59_130_246/0.34),rgb(144_133_233/0.24)_55%,rgb(25_158_112/0.18))]" />
      <div className="flex flex-wrap items-end justify-between gap-4 px-4 pb-4 @[38rem]:px-5">
        <div className="flex min-w-0 flex-1 basis-64 items-start gap-4">
          <div className={cn('-mt-10 shrink-0 ring-4 ring-surface-panel', square ? 'rounded-[30%]' : 'rounded-full')}>{avatar}</div>
          <div className="min-w-0 flex-1 pt-3">
            <h1 className="admin-page-heading">{title}</h1>
            {subtitle && <p className="mt-1 wrap-anywhere text-label text-text-muted">{subtitle}</p>}
            <div className="mt-2 inline-flex max-w-full items-center gap-1 rounded-md bg-fill-subtle pl-2 text-caption text-text-muted">
              <code className="min-w-0 wrap-anywhere">{id}</code>
              <CopyIdButton id={id} label={t('ui.copyId', { name: title })} />
            </div>
          </div>
        </div>
        {badges && <div className="flex min-w-0 flex-wrap items-center gap-2">{badges}</div>}
      </div>
    </header>
  );
}
