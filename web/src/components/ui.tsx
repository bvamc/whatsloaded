import { cva, type VariantProps } from 'class-variance-authority';
import { Check, X } from 'lucide-react';
import { Dialog, Checkbox as RCheckbox, Switch as RSwitch, Tooltip as RTooltip } from 'radix-ui';
import { type ButtonHTMLAttributes, forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/meta';

const button = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background,color,box-shadow,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lume/60 cursor-pointer',
  {
    variants: {
      variant: {
        primary: 'bg-lume text-ink-0 hover:bg-lume-2 shadow-[0_0_0_1px_rgb(242_169_59/0.4),0_8px_24px_-8px_rgb(242_169_59/0.55)]',
        outline: 'border border-white/10 bg-ink-2/60 text-paper hover:bg-ink-3 hover:border-white/20',
        ghost: 'text-paper-2 hover:bg-white/5 hover:text-paper',
        danger: 'border border-bad/30 text-bad hover:bg-bad/10',
      },
      size: { sm: 'h-7 px-2.5 text-[12.5px]', md: 'h-8 px-3 text-[13px]', icon: 'h-7 w-7' },
    },
    defaultVariants: { variant: 'outline', size: 'md' },
  },
);

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>>(
  ({ className, variant, size, ...props }, ref) => (
    <button type="button" ref={ref} className={cn(button({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';

export function Badge({
  children,
  tone = 'muted',
  className,
}: {
  children: ReactNode;
  tone?: 'muted' | 'lume' | 'coat' | 'bad' | 'ok';
  className?: string;
}) {
  const tones = {
    muted: 'border-white/10 text-paper-3',
    lume: 'border-lume/35 text-lume bg-lume/8',
    coat: 'border-coat/30 text-coat bg-coat/6',
    bad: 'border-bad/35 text-bad bg-bad/8',
    ok: 'border-ok/30 text-ok bg-ok/6',
  };
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-[5px] border px-1.5 font-mono text-[10.5px] leading-none tracking-wide',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-white/10 bg-ink-3 px-1 font-mono text-[10.5px] text-paper-3">
      {children}
    </kbd>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <RSwitch.Root
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={label}
      className="relative h-[18px] w-8 shrink-0 cursor-pointer rounded-full border border-white/10 bg-ink-4 transition-colors data-[state=checked]:border-ok/40 data-[state=checked]:bg-ok/25 disabled:opacity-40"
    >
      <RSwitch.Thumb className="block h-3 w-3 translate-x-[3px] rounded-full bg-paper-3 transition-transform duration-200 data-[state=checked]:translate-x-[15px] data-[state=checked]:bg-ok data-[state=checked]:shadow-[0_0_10px_rgb(147_212_140/0.7)]" />
    </RSwitch.Root>
  );
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the Radix checkbox inside is the control (a button with role=checkbox)
    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-paper-2 select-none">
      <RCheckbox.Root
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="flex h-4 w-4 items-center justify-center rounded-[4px] border border-white/15 bg-ink-3 data-[state=checked]:border-lume data-[state=checked]:bg-lume"
      >
        <RCheckbox.Indicator>
          <Check className="h-3 w-3 text-ink-0" strokeWidth={3} />
        </RCheckbox.Indicator>
      </RCheckbox.Root>
      {children}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-8 w-full rounded-md border border-white/10 bg-ink-2/70 px-2.5 text-[13px] text-paper placeholder:text-paper-4 focus:border-lume/50 focus:outline-none focus:ring-2 focus:ring-lume/15',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export function Tip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <RTooltip.Root delayDuration={250}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          className="z-[60] max-w-sm animate-fade rounded-md border border-white/10 bg-ink-3/95 px-2.5 py-1.5 font-mono text-[11.5px] text-paper-2 shadow-xl backdrop-blur"
        >
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export const TipProvider = RTooltip.Provider;

/** Right-hand inspector panel. */
export function Sheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title: string }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 animate-fade bg-ink-0/50 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-0 right-0 bottom-0 z-50 flex w-[min(640px,100vw)] animate-slide-in flex-col border-l border-white/10 bg-ink-1/95 shadow-[-30px_0_80px_-20px_rgb(0_0_0/0.8)] backdrop-blur-xl focus:outline-none"
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <Dialog.Close
            className="absolute top-4 right-4 z-10 rounded-md p-1 text-paper-3 hover:bg-white/5 hover:text-paper"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Centered modal. */
export function Modal({
  open,
  onClose,
  children,
  title,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title: string;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[55] animate-fade bg-ink-0/70 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            'fixed top-[10vh] left-1/2 z-[56] flex max-h-[80vh] w-[min(var(--w),calc(100vw-32px))] -translate-x-1/2 animate-pop flex-col overflow-hidden rounded-xl border border-white/10 bg-ink-1 shadow-[0_40px_120px_-20px_rgb(0_0_0/0.9),0_0_0_1px_rgb(255_255_255/0.02)] focus:outline-none',
          )}
          style={{ ['--w' as string]: wide ? '880px' : '560px' }}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-[10.5px] font-medium tracking-[0.16em] text-paper-4 uppercase">{children}</h3>
      {right}
    </div>
  );
}
