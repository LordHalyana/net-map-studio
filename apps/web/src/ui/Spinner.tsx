type SpinnerProps = {
  size?: 'sm' | 'md';
  /** Sets the aria-label — what the wait is for, e.g. "Loading imports". */
  label?: string;
  className?: string;
};

/** Shared loading indicator (#90 B2) — a token-colored ring. Pair with
 *  `.panel-loading` for panel bodies, or drop inline into a busy Button.
 *  Announced to assistive tech via role="status" + aria-label. */
export function Spinner({ size = 'md', label = 'Loading', className }: SpinnerProps) {
  return (
    <span
      className={['spinner', size === 'sm' && 'spinner--sm', className].filter(Boolean).join(' ')}
      role="status"
      aria-label={label}
    />
  );
}
