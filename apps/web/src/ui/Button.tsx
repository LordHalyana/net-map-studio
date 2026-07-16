import type { ButtonHTMLAttributes } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** default: bordered raised button; primary: filled accent; danger:
   *  destructive outline; ghost: borderless, for low-emphasis actions. */
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
};

/** Shared button (ui-polish M2) — layers .btn classes over the base button
 *  element styles; all button HTML attributes (incl. data-testid) pass through. */
export function Button({
  variant = 'default',
  size = 'md',
  className,
  type,
  ...rest
}: ButtonProps) {
  const classes = ['btn', `btn--${variant}`, `btn--${size}`, className].filter(Boolean).join(' ');
  return <button type={type ?? 'button'} className={classes} {...rest} />;
}
