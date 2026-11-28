import type { ComponentProps } from 'react';
import { EyeIcon } from '@/shared/ui/icons';
import { Button } from '@/shared/ui/primitives/button';
import { cn } from '@/shared/lib/utils';

/** "Assistir" over a share that is not playing yet, on the call tile and on the
 * "ao vivo" hover preview. Dark glass like the tile's name label rather than an
 * accent button, so it sits on the blurred still without shouting over it. */
export function WatchButton({ label, className, labelClassName, ...props }: Omit<ComponentProps<typeof Button>, 'children' | 'variant' | 'size'> & {
  label: string;
  labelClassName?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        'h-8 gap-1.5 rounded-md border-white/15 bg-black/60 px-3 text-label font-medium text-white backdrop-blur-md',
        'hover:bg-black/80 hover:text-white aria-expanded:bg-black/80',
        className,
      )}
      {...props}
    >
      <EyeIcon aria-hidden className="size-4" />
      <span className={labelClassName}>{label}</span>
    </Button>
  );
}
