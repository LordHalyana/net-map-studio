import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export type MenuItem =
  | {
      label: string;
      icon?: LucideIcon;
      onSelect: () => void;
      disabled?: boolean;
      'data-testid'?: string;
    }
  | 'separator';

type MenuProps = {
  /** The trigger button content; the Menu owns open/close behavior. */
  triggerLabel: ReactNode;
  triggerTestId?: string;
  items: MenuItem[];
  listTestId?: string;
};

/** Dropdown menu (ui-polish M4): closes on outside pointerdown and Esc
 *  (returning focus to the trigger), arrow keys walk the items. */
export function Menu({ triggerLabel, triggerTestId, items, listTestId }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function moveFocus(delta: number) {
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    );
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(index + delta + buttons.length) % buttons.length]?.focus();
  }

  return (
    <div className="menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        data-testid={triggerTestId}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && open) {
            event.preventDefault();
            moveFocus(1);
          }
        }}
      >
        {triggerLabel}
      </button>
      {open && (
        <div
          className="menu__list"
          ref={listRef}
          role="menu"
          data-testid={listTestId}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              moveFocus(event.key === 'ArrowDown' ? 1 : -1);
            }
          }}
        >
          {items.map((item, index) =>
            item === 'separator' ? (
              <div key={`sep-${index}`} className="menu__sep" role="separator" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className="menu__item"
                disabled={item.disabled}
                data-testid={item['data-testid']}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon && <item.icon size={14} className="menu__icon" aria-hidden />}
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
