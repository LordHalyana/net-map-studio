import { useRef } from 'react';

type Tab = { id: string; label: string };

type TabsProps = {
  tabs: Tab[];
  /** Active tab id; null renders no tab highlighted (e.g. a mode overrides). */
  active: string | null;
  onSelect: (id: string) => void;
  /** Container class — callers keep their existing tab-strip styling. */
  className?: string;
  /** data-testid per tab: `${testIdPrefix}${tab.id}`. */
  testIdPrefix?: string;
};

/** Tab strip (ui-polish M4): role=tablist semantics with arrow-key focus. */
export function Tabs({ tabs, active, onSelect, className, testIdPrefix }: TabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = (index + delta + tabs.length) % tabs.length;
    const tab = tabs[next];
    if (!tab) return;
    refs.current[next]?.focus();
    onSelect(tab.id);
  }

  return (
    <div className={className} role="tablist">
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          tabIndex={active === tab.id || (active === null && index === 0) ? 0 : -1}
          className={active === tab.id ? 'toggle--on' : ''}
          data-testid={testIdPrefix ? `${testIdPrefix}${tab.id}` : undefined}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
