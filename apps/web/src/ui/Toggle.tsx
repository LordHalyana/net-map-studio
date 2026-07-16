type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Sets the title tooltip and aria-label. */
  label?: string;
  disabled?: boolean;
  /** Extra class on the switch (e.g. switch--inline). */
  className?: string;
  'data-testid'?: string;
};

/** iOS-style switch (ui-polish M4) — the one Toggle, replacing the inline
 *  .switch copies. The invisible input fills the control, so pointer and
 *  automation land on the real checkbox (M6, #63). */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  className,
  'data-testid': testid,
}: ToggleProps) {
  return (
    <label className={['switch', className].filter(Boolean).join(' ')} title={label}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        data-testid={testid}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch__track" />
    </label>
  );
}
