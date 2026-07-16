import { Dialog } from '../ui';
import { SHORTCUTS } from './shortcuts';

/** `?`-key shortcut cheat sheet (M2, #59) on the shared Dialog (ui-polish M4). */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open title="Keyboard shortcuts" onClose={onClose} data-testid="shortcut-help">
      <table className="shortcut-help__table">
        <tbody>
          {SHORTCUTS.map(({ keys, action }) => (
            <tr key={keys}>
              <td className="shortcut-help__keys">
                <kbd>{keys}</kbd>
              </td>
              <td>{action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
