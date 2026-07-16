import { useEffect, useRef, type ReactNode } from 'react';

type DialogProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  role?: 'dialog' | 'alertdialog';
  'data-testid'?: string;
};

/** Modal dialog (ui-polish M2): backdrop click and Esc close it; focus moves
 *  into the panel on open and returns to the trigger on close. */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  role = 'dialog',
  'data-testid': testid,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    panelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="dialog__backdrop" data-testid={testid} onClick={onClose}>
      <div
        ref={panelRef}
        className="dialog"
        role={role}
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="dialog__title">{title}</h2>
        <div className="dialog__body">{children}</div>
        {footer && <div className="dialog__footer">{footer}</div>}
      </div>
    </div>
  );
}
