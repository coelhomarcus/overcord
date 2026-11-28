import { cn } from '@/shared/lib/utils';
import mark from './admin-mark.svg?no-inline';

export function AdminBrand({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2 whitespace-nowrap', className)}>
      <img src={mark} alt="" width={32} height={32} className="size-8 shrink-0" />
      <span className="flex flex-col gap-0.5">
        <span className="text-label leading-none font-bold tracking-tight text-text-strong">Overcord</span>
        <span className="text-micro leading-none font-semibold tracking-[0.08em] text-accent-text uppercase">Admin</span>
      </span>
    </span>
  );
}
