import { format, parseISO } from "date-fns";

import type { components } from "../../api/schema";
import styles from "./Profile.module.css";
import { ProfileSettings } from "./ProfileSettings";
import { ProfileSummary } from "./ProfileSummary";

/**
 * The signed-in user looking at their own profile.
 *
 * It takes `MeOut` — the response of `GET /users/me`, which is the only shape
 * that carries `date_of_birth`. `PublicProfile` takes `PublicUserOut`, which
 * does not have the field to render, so the privacy rule holds by types rather
 * than by everyone remembering it.
 *
 * There is no follow control here: following yourself is not a thing, and the
 * settings form takes its place.
 */

type MeOut = components["schemas"]["MeOut"];

/**
 * `date_of_birth` is a date, not an instant. `parseISO` reads a date-only string
 * as local midnight; `new Date(...)` would read it as UTC and show the day
 * before to anyone west of Greenwich.
 */
function formatDateOfBirth(value: string): string {
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, "d MMMM yyyy");
}

export interface OwnProfileProps {
  profile: MeOut;
}

export function OwnProfile({ profile }: OwnProfileProps) {
  return (
    <section className={styles.page}>
      <ProfileSummary
        username={profile.username}
        followerCount={profile.follower_count}
        followingCount={profile.following_count}
      />

      {profile.description === null ? null : <p>{profile.description}</p>}

      {/* Never rendered on a public profile: `PublicProfile` has no such field. */}
      <dl className={styles.private}>
        <dt className={styles.privateLabel}>Date of birth</dt>
        <dd>{formatDateOfBirth(profile.date_of_birth)}</dd>
        <dd className={styles.muted}>Only you can see this</dd>
      </dl>

      <ProfileSettings profile={profile} />
    </section>
  );
}
