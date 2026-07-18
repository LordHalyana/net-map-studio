import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';

type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label' | 'title'
> & {
  icon: LucideIcon;
  /** Sets aria-label and (unless overridden) the native title tooltip — an
   *  icon-only control is never unlabeled by construction. */
  label: string;
  /** Tooltip text when it must differ from the accessible name (e.g. a
   *  disabled-state explanation). */
  title?: string;
  size?: 'sm' | 'md';
  variant?: 'default' | 'danger';
  /** Toggle state — sets aria-pressed and (non-bare) the accent "on" look. */
  pressed?: boolean;
  /**
   * Skip the icon-btn chrome entirely: visuals come from `className` (or the
   * surrounding context), the primitive contributes only the accessible-name
   * and pressed-state contract (#110 D5). For controls whose existing look
   * must not change.
   */
  bare?: boolean;
  /** Override the icon glyph size (defaults per `size`). */
  iconSize?: number;
};

/** Icon-only button (ui-polish M2), modeled on the canvas-toolbar pattern. */
export function IconButton({
  icon: Icon,
  label,
  title,
  size = 'md',
  variant = 'default',
  pressed,
  bare = false,
  iconSize,
  className,
  type,
  ...rest
}: IconButtonProps) {
  const classes = [
    !bare && 'icon-btn',
    !bare && size === 'sm' && 'icon-btn--sm',
    !bare && variant === 'danger' && 'icon-btn--danger',
    !bare && pressed && 'icon-btn--on',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type={type ?? 'button'}
      className={classes}
      aria-label={label}
      title={title ?? label}
      aria-pressed={pressed}
      {...rest}
    >
      <Icon size={iconSize ?? (size === 'sm' ? 14 : 16)} aria-hidden />
    </button>
  );
}
