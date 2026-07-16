import { X } from 'lucide-react';
import { useAppStore } from '../state/store';
import { SHORTCUTS } from '../layout/shortcuts';

/** Always-on-canvas shortcut cheat card (ui-polish M7). Dismissing it turns
 *  the persisted preference off; Settings → Interface turns it back on. */
export function HotkeyCard() {
  const enabled = useAppStore((s) => s.hotkeyCardEnabled);
  const setEnabled = useAppStore((s) => s.setHotkeyCardEnabled);
  if (!enabled) return null;
  return (
    <aside className="hotkey-card" data-testid="hotkey-card">
      <div className="hotkey-card__head">
        <span className="hotkey-card__title">Shortcuts</span>
        <button
          type="button"
          className="hotkey-card__dismiss"
          data-testid="hotkey-card-dismiss"
          title="Hide (re-enable under Settings → Interface)"
          aria-label="Hide shortcut card"
          onClick={() => setEnabled(false)}
        >
          <X size={12} aria-hidden />
        </button>
      </div>
      <ul className="hotkey-card__list">
        {SHORTCUTS.map(({ keys, action, short }) => (
          <li key={keys}>
            <kbd>{keys}</kbd>
            <span>{short ?? action}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
