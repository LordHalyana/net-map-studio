import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useAppStore, type Toast } from '../state/store';
import { IconButton } from '../ui';

const AUTO_DISMISS_MS = 6000;

/**
 * The one notification surface (M6, #63): a queued, auto-dismissing toast
 * stack replacing the scattered inline notices. Inline field-validation
 * errors stay inline — this is for events, not form state.
 */
export function Toasts() {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" data-testid="toast-stack">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);
  return (
    <div
      className={`toast toast--${toast.severity}`}
      data-testid={`toast-${toast.severity}`}
      role="status"
    >
      <span className="toast__message">{toast.message}</span>
      <IconButton
        icon={X}
        iconSize={13}
        bare
        className="toast__dismiss"
        label="Dismiss"
        data-testid="toast-dismiss"
        onClick={onDismiss}
      />
    </div>
  );
}
