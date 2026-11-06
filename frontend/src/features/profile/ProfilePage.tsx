import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import { useAccount } from "../../auth/account";
import { Button } from "../../components/ui/Button";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { OwnProfile } from "./OwnProfile";
import styles from "./Profile.module.css";
import { ProfileLoading } from "./ProfileLoading";
import { PublicProfile } from "./PublicProfile";
import {
  FOLLOWING_QUERY_KEY,
  fetchFollowing,
  fetchPublicProfile,
  viewedUserKey,
} from "./api";

/**
 * `/profile/:userId` — one public route, two variants.
 *
 * The id in the path is the only thing that selects between them: it renders the
 * **own** profile when it is the signed-in user's id, and the **public** profile
 * otherwise. There is no second route and no `/settings`, because settings are
 * one section of the page a user already has an address for.
 *
 * The comparison is numeric on both sides. `useParams` hands back a string and
 * the generated schema's path parameter is a number, so `"7" === 7` would be
 * false for the one person it matters for.
 *
 * `GET /users/me` is read through `useAccount()` (`auth/account.ts`), on the
 * one shared profile query, never a second key: the guards already read it,
 * and a duplicate entry costs a round trip on every profile view and can answer
 * two readers differently. Only an **active** account has an own profile: a
 * deactivated one sees every profile, its own included, as a guest does
 * (`FRONTEND-012`).
 *
 * The public read is skipped entirely on the own-profile variant — `MeOut` is a
 * superset of `PublicUserOut`, so there is nothing left to ask for.
 */
export function ProfilePage() {
  const { userId: userIdParam } = useParams<{ userId: string }>();
  const userId = Number(userIdParam);
  const account = useAccount();
  const ownProfile = account.status === "active" ? account.profile : null;

  const resolvingOwn = account.status === "loading";
  const isOwnProfile = ownProfile !== null && ownProfile.id === userId;

  // Held until "is this me?" has an answer, so the own-profile variant never
  // issues a public read it is about to throw away.
  const readsPublicProfile =
    Number.isInteger(userId) && !resolvingOwn && !isOwnProfile;

  const viewed = useQuery({
    queryKey: viewedUserKey(userId),
    queryFn: () => fetchPublicProfile(userId),
    enabled: readsPublicProfile,
  });

  /**
   * The follow set is read here rather than inside the button, in parallel with
   * the profile: the two are rendered together, so fetching them in sequence
   * would show the counts while the button was still guessing. Never asked
   * without a session — an anonymous read of it is a 401 — nor by a
   * deactivated account, whose read of it is a 403.
   */
  const readsFollowSet =
    readsPublicProfile &&
    account.status !== "anonymous" &&
    account.status !== "deactivated";
  const followSet = useQuery({
    queryKey: FOLLOWING_QUERY_KEY,
    queryFn: fetchFollowing,
    enabled: readsFollowSet,
  });

  if (!Number.isInteger(userId)) {
    return <InlineAlert>There is no profile at this address.</InlineAlert>;
  }
  if (ownProfile !== null && ownProfile.id === userId) {
    return <OwnProfile profile={ownProfile} />;
  }
  if (
    resolvingOwn ||
    viewed.isPending ||
    (readsFollowSet && followSet.isPending)
  ) {
    // The same state the route's Suspense shows while this page's chunk
    // loads (`FRONTEND-033`), so the two waits read as one.
    return <ProfileLoading />;
  }
  if (viewed.isError || viewed.data === undefined) {
    // HistoryPage's failure treatment: the alert, then a Retry that asks again.
    return (
      <section className={styles.failure}>
        <InlineAlert>
          We could not load this profile just now. Please try again.
        </InlineAlert>
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={() => void viewed.refetch()}
          disabled={viewed.isFetching}
        >
          Retry
        </Button>
      </section>
    );
  }
  return (
    <PublicProfile
      profile={viewed.data}
      isFollowing={(followSet.data ?? []).includes(userId)}
    />
  );
}
