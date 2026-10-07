import type { components } from "../../api/schema";
import { FollowButton } from "./FollowButton";
import styles from "./Profile.module.css";
import { ProfileSummary } from "./ProfileSummary";

/**
 * Somebody else's profile — readable signed out ([[0x01-users]] Security).
 *
 * It takes `PublicUserOut`, which has no `date_of_birth` field at all, and it
 * reads nothing from the caller's own `MeOut` even when that is sitting in the
 * cache. There is no branch here that could show a private field: there is no
 * private field in scope.
 *
 * Follow/Unfollow goes in the header card's action slot, on its right edge.
 */

type PublicUserOut = components["schemas"]["PublicUserOut"];

export interface PublicProfileProps {
  profile: PublicUserOut;
  /** Read by the page, so the counts and the button's state arrive together. */
  isFollowing: boolean;
}

export function PublicProfile({ profile, isFollowing }: PublicProfileProps) {
  return (
    <section className={styles.page}>
      <ProfileSummary
        username={profile.username}
        followerCount={profile.follower_count}
        followingCount={profile.following_count}
        action={<FollowButton userId={profile.id} isFollowing={isFollowing} />}
      />

      {profile.description === null ? null : <p>{profile.description}</p>}
    </section>
  );
}
