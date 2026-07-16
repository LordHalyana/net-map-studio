/** The one shortcut registry (ui-polish M4/M7): the `?` cheat sheet and the
 *  canvas hotkey card both render from this list so they cannot drift.
 *  Keep in sync with the handlers in useGlobalShortcuts.ts and Canvas.tsx. */
export interface Shortcut {
  keys: string;
  action: string;
  /** Compact wording for the canvas card; falls back to `action`. */
  short?: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { keys: 'Ctrl+Z', action: 'Undo' },
  { keys: 'Ctrl+Shift+Z / Ctrl+Y', action: 'Redo' },
  { keys: 'Ctrl+D', action: 'Duplicate selected device', short: 'Duplicate' },
  {
    keys: 'Ctrl+C / Ctrl+V',
    action: 'Copy / paste devices (links & memberships not copied)',
    short: 'Copy / paste',
  },
  { keys: 'Ctrl+F or /', action: 'Focus search', short: 'Search' },
  { keys: 'Delete / Backspace', action: 'Delete selection', short: 'Delete' },
  {
    keys: 'Esc',
    action: 'Clear selection · exit connect mode · close dialogs',
    short: 'Clear selection',
  },
  { keys: '?', action: 'Toggle the shortcut cheat sheet', short: 'All shortcuts' },
];
