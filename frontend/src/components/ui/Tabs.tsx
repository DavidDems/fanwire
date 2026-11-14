import { NavLink } from "react-router-dom";

import styles from "./Tabs.module.css";

export interface TabItem {
  /** The tab's own route. */
  to: string;
  /** The visible text, which is also the link's accessible name. */
  label: string;
}

export interface TabsProps {
  /** Names the `<nav>` landmark, for example "Stats". */
  label: string;
  items: TabItem[];
}

/**
 * A row of links that look like tabs (`FRONTEND-009`): a `<nav>` named by
 * `label`, one `NavLink` per item, and `aria-current="page"` on the link of the
 * current route, which is what the CSS keys the selected bar and weight on.
 *
 * **This is deliberately not an ARIA tablist; do not "fix" it to
 * `role="tab"`.** A `tablist` / `tab` / `tabpanel` set promises panels inside
 * one page, switched with the arrow keys, with only the selected tab in the Tab
 * order. These tabs are separate routes: each has its own address, the URL
 * alone decides which one shows, Back moves between them, and a link can be
 * opened in a new tab or shared. That is the "links styled as tabs" pattern, so
 * the semantics are the links' own, every tab is one Tab stop, and the current
 * one says so with `aria-current="page"`, exactly as the primary nav does.
 */
export function Tabs({ label, items }: TabsProps) {
  return (
    <nav aria-label={label} className={styles.tabs}>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} className={styles.tab}>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
