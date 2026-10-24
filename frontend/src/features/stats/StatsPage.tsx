import { Outlet } from "react-router-dom";

import { Tabs } from "../../components/ui/Tabs";
import styles from "./StatsPage.module.css";

const TABS = [
  { to: "/stats/seasons", label: "Seasons" },
  { to: "/stats/players", label: "Players" },
];

/**
 * `/stats/*`: one "Stats" heading, the tab list, and the current tab's route.
 *
 * **Tabs are routes, not state.** `/stats/seasons` and `/stats/players` are
 * child routes rendered into the `Outlet`, so the address alone decides which
 * tab shows, a tab can be linked to or reloaded, and Back moves between them.
 * Public, like every other read of sports data ([[0x02-events]]).
 */
export function StatsPage() {
  return (
    <section className={styles.page}>
      <h1 className={styles.heading}>Stats</h1>
      <Tabs label="Stats" items={TABS} />
      <Outlet />
    </section>
  );
}
