import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';

type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label' | 'title'
> & {
  icon: LucideIcon;
  /** Sets both aria-label and the native title tooltip — an icon-only
   *  control is never unlabeled by construction. */
  label: string;
  size?: 'sm' | 'md';
  variant?: 'default' | 'danger';
  /** Toggle state — sets aria-pressed and the accent "on" look. */
  pressed?: boolean;
};

/** Icon-only button (ui-polish M2), modeled on the canvas-toolbar pattern. */
export function IconButton({
  icon: Icon,
  label,
  size = 'md',
  variant = 'default',
  pressed,
  className,
  type,
  ...rest
}: IconButtonProps) {
  const classes = [
    'icon-btn',
    size === 'sm' && 'icon-btn--sm',
    variant === 'danger' && 'icon-btn--danger',
    pressed && 'icon-btn--on',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type={type ?? 'button'}
      className={classes}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      {...rest}
    >
      <Icon size={size === 'sm' ? 14 : 16} />
    </button>
  );
}
