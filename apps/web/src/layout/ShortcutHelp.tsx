/** `?`-key shortcut cheat sheet (M2, #59) — static, no dependencies. */
const SHORTCUTS: [string, string][] = [
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Shift+Z / Ctrl+Y', 'Redo'],
  ['Ctrl+D', 'Duplicate selected device'],
  ['Ctrl+C / Ctrl+V', 'Copy / paste devices (links & memberships not copied)'],
  ['Ctrl+F or /', 'Focus search'],
  ['Delete / Backspace', 'Delete selection'],
  ['Esc', 'Clear selection · exit connect mode · close this help'],
  ['?', 'Toggle this cheat sheet'],
];

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="shortcut-help__backdrop"
      data-testid="shortcut-help"
      role="dialog"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
    >
      <div className="shortcut-help" onClick={(event) => event.stopPropagation()}>
        <h2 className="shortcut-help__title">Keyboard shortcuts</h2>
        <table className="shortcut-help__table">
          <tbody>
            {SHORTCUTS.map(([keys, action]) => (
              <tr key={keys}>
                <td className="shortcut-help__keys">
                  <kbd>{keys}</kbd>
                </td>
                <td>{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
