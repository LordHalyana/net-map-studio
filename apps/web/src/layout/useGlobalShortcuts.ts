import { useEffect } from 'react';
import { useAppStore } from '../state/store';
import {
  duplicateDevicesChangeSet,
  pasteDevicesChangeSet,
  type DeviceClipboard,
} from '../state/ops';

/** Module-level so the clipboard survives re-renders and view switches. */
let clipboard: DeviceClipboard | null = null;

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * Global keyboard shortcuts (M2, #59). Registered once on window; inert while
 * an input, textarea, select or contenteditable has focus. Delete/Backspace
 * stay with React Flow (`Canvas.tsx` deleteKeyCode).
 */
export function useGlobalShortcuts(helpOpen: boolean, setHelpOpen: (open: boolean) => void) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      const store = useAppStore.getState();

      if (event.ctrlKey || event.metaKey) {
        switch (event.key.toLowerCase()) {
          case 'z':
            event.preventDefault();
            if (event.shiftKey) void store.redo();
            else void store.undo();
            return;
          case 'y':
            event.preventDefault();
            void store.redo();
            return;
          case 'd': {
            event.preventDefault();
            const { graph, selection } = store;
            if (graph && selection?.entityType === 'device') {
              const cs = duplicateDevicesChangeSet(graph, selection.ids);
              if (cs) store.dispatch(cs);
            }
            return;
          }
          case 'c': {
            // a real text selection means the user wants a text copy
            if (window.getSelection()?.toString()) return;
            const { graph, selection } = store;
            if (graph && selection?.entityType === 'device') {
              const ids = new Set(selection.ids);
              const devices = graph.devices.filter((d) => ids.has(d.id));
              const interfaces = graph.interfaces.filter((i) => ids.has(i.deviceId));
              const ifaceIds = new Set(interfaces.map((i) => i.id));
              const addresses = graph.addresses.filter((a) => ifaceIds.has(a.interfaceId));
              if (devices.length > 0) clipboard = { devices, interfaces, addresses };
            }
            return;
          }
          case 'v': {
            const { graph } = store;
            if (graph && clipboard) {
              event.preventDefault();
              const cs = pasteDevicesChangeSet(graph, clipboard);
              if (cs) store.dispatch(cs);
            }
            return;
          }
          case 'f':
            event.preventDefault();
            window.dispatchEvent(new CustomEvent('netplan:focus-search'));
            return;
          default:
            return;
        }
      }

      if (event.key === '/') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('netplan:focus-search'));
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        setHelpOpen(!helpOpen);
        return;
      }
      if (event.key === 'Escape') {
        if (helpOpen) {
          setHelpOpen(false);
        } else if (store.connectMode) {
          store.toggleConnectMode();
        } else if (store.selection) {
          store.select(null);
          window.dispatchEvent(new CustomEvent('netplan:clear-selection'));
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [helpOpen, setHelpOpen]);
}
