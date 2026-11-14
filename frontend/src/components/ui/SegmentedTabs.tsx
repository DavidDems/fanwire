import { useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import styles from "./SegmentedTabs.module.css";

export interface SegmentedTab {
  /** What `value` and `onChange` speak in. */
  id: string;
  /** The visible text, which is also the tab's accessible name. */
  label: string;
}

export interface SegmentedTabsProps {
  /** Names the tablist, for example "Conference". */
  label: string;
  tabs: SegmentedTab[];
  /** The selected tab's id. The parent owns it. */
  value: string;
  onChange: (id: string) => void;
  /**
   * The selected tab's panel. As a function it is handed the tablist and
   * places it itself, inside the panel (the records tab puts its view bar
   * in another bar's row).
   */
  children?: ReactNode | ((bar: ReactNode) => ReactNode);
  /**
   * Something to set after the tablist, in one row, at the row's end (the
   * records tab's view bar). The row wraps when the two do not fit.
   */
  end?: ReactNode;
}

/**
 * An in-page tab bar (`UI-010`): an ARIA tablist that switches one panel on
 * the same page, unlike `Tabs`, whose tabs are routes. One `tabpanel` holds
 * `children`, labelled by the selected tab; only the selected tab is in the Tab
 * order, and ArrowLeft / ArrowRight (wrapping), Home and End move to a tab and
 * select it (the WAI-ARIA tabs pattern with automatic activation). Ids come
 * from `useId`, so two bars on one page never share one.
 */
export function SegmentedTabs({
  label,
  tabs,
  value,
  onChange,
  children,
  end,
}: SegmentedTabsProps) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelId = `${base}-panel`;
  const tabId = (id: string) => `${base}-tab-${id}`;
  const selected = tabs.findIndex((tab) => tab.id === value);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const last = tabs.length - 1;
    const from = Math.max(selected, 0);
    let target: number;
    if (event.key === "ArrowRight") target = from === last ? 0 : from + 1;
    else if (event.key === "ArrowLeft") target = from === 0 ? last : from - 1;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = last;
    else return;
    event.preventDefault();
    onChange(tabs[target].id);
    refs.current[target]?.focus();
  }

  const tablist = (
    <div
      role="tablist"
      aria-label={label}
      className={styles.tablist}
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab, index) => {
        const isSelected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={tabId(tab.id)}
            aria-selected={isSelected}
            aria-controls={panelId}
            tabIndex={isSelected ? 0 : -1}
            className={styles.tab}
            onClick={() => {
              onChange(tab.id);
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
  const bar =
    end === undefined ? tablist : <SegmentedRow start={tablist} end={end} />;
  const placed = typeof children === "function";

  return (
    <div className={styles.segmented}>
      {placed ? null : bar}
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(value)}
        tabIndex={0}
      >
        {placed ? children(bar) : children}
      </div>
    </div>
  );
}

/**
 * The row `end` lays out, for a caller that sets a bar beside other things
 * (the records tab's season picker): `start` at the row's start, `end` at
 * its end, wrapping to a line of its own when the two do not fit.
 */
export function SegmentedRow({
  start,
  end,
}: {
  start?: ReactNode;
  end: ReactNode;
}) {
  return (
    <div className={styles.row}>
      {start}
      <div className={styles.end}>{end}</div>
    </div>
  );
}
