import type { ReactNode } from "react";

import { Avatar } from "../../components/ui/Avatar";
import { Card } from "../../components/ui/Card";
import styles from "./Profile.module.css";

/**
 * The identity both profile variants show: the avatar, the username, and the
 * two counts, in the header card (`layout.md` §3).
 *
 * **It takes three scalars, never a user object.** That is the point of the
 * file. The backend's public user response leaked `date_of_birth` once already
 * and was fixed by splitting `PublicUserOut` off `MeOut`; the frontend is the
 * second place the same leak happens — by rendering one header that takes a
 * whole user and shows every field it finds. A component that is only ever
 * handed a name and two numbers cannot render a third field, whatever the
 * caller has in scope. The avatar is built from the username it already has.
 *
 * `action` is a slot, not user data: the public variant puts Follow/Unfollow
 * there, on the right of the card (under the name on phones).
 *
 * The counts are single text nodes rather than a number next to a word, so the
 * element's whole text is what a reader (and a test) sees.
 */

export interface ProfileSummaryProps {
  username: string;
  followerCount: number;
  followingCount: number;
  /** A control for the header card's right edge: Follow/Unfollow. Never user data. */
  action?: ReactNode;
}

export function ProfileSummary({
  username,
  followerCount,
  followingCount,
  action,
}: ProfileSummaryProps) {
  return (
    <Card>
      <header className={styles.header}>
        <Avatar username={username} size="lg" />
        <div className={styles.identity}>
          <h1>{username}</h1>
          <ul className={styles.counts}>
            <li>{`${followerCount} followers`}</li>
            <li>{`${followingCount} following`}</li>
          </ul>
        </div>
        {action === undefined ? null : (
          <div className={styles.action}>{action}</div>
        )}
      </header>
    </Card>
  );
}
