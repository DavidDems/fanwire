import { Card } from "../../components/ui/Card";
import { Skeleton } from "../../components/ui/Skeleton";
import { StatusLine } from "../../components/ui/StatusLine";
import styles from "./ProfileLoading.module.css";

/**
 * What `/profile/:userId` shows while the profile is not ready yet
 * (`FRONTEND-033`): both while the page's chunk loads (the route's own
 * Suspense fallback in `routes.tsx`) and while `ProfilePage` waits for its data.
 *
 * A module of its own, never part of `ProfilePage.tsx`: the route table
 * imports it statically, and `ProfilePage` must stay in its lazy chunk
 * (`routes/lazy-routes.test.ts`).
 *
 * The existing pattern (`components.md`: `StatusLine` + `Skeleton`): the
 * `role="status"` line is the one thing announced, and the placeholders are
 * `aria-hidden`. The header card's skeleton is laid out like `ProfileSummary`
 * (a `lg` avatar beside the name and the counts, in a `Card`), first in the
 * page, so the card revealed in its place moves nothing. The line sits under
 * it, where the description goes. No heading (nobody's name is known yet) and
 * no focus movement.
 */
export function ProfileLoading() {
  return (
    <section className={styles.page}>
      <div aria-hidden="true">
        <Card>
          <div className={styles.header}>
            <div className={styles.avatar} />
            <div className={styles.identity}>
              <div className={styles.name}>
                <Skeleton variant="line" />
              </div>
              <div className={styles.counts}>
                <Skeleton variant="line" />
              </div>
            </div>
          </div>
        </Card>
      </div>
      <StatusLine>Loading this profile…</StatusLine>
    </section>
  );
}
