import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import { useAuth } from "../../auth/AuthContext";
import { useProfile } from "../../auth/profile";
import { OwnProfile } from "./OwnProfile";
import { PublicProfile } from "./PublicProfile";
import { FOLLOWING_QUERY_KEY, fetchFollowing, fetchPublicProfile, viewedUserKey } from "./api";

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
 * `GET /users/me` is read through `auth/profile.ts`'s shared query, never a
 * second key: the guards already read it, and a duplicate entry costs a round
 * trip on every profile view and can answer two readers differently.
 *
 * The public read is skipped entirely on the own-profile variant — `MeOut` is a
 * superset of `PublicUserOut`, so there is nothing left to ask for.
 */
export function ProfilePage() {
  const { userId: userIdParam } = useParams<{ userId: string }>();
  const userId = Number(userIdParam);
  const { status } = useAuth();

  // Never asked without a session, the way `routes/guards.tsx` asks it: a
  // profile lookup with no token is a 401 the page would have to explain away.
  const own = useProfile(status === "authenticated");
  const ownProfile = status === "authenticated" ? (own.data ?? null) : null;

  const resolvingOwn = status === "loading" || (status === "authenticated" && own.isPending);
  const isOwnProfile = ownProfile !== null && ownProfile.id === userId;

  // Held until "is this me?" has an answer, so the own-profile variant never
  // issues a public read it is about to throw away.
  const readsPublicProfile = Number.isInteger(userId) && !resolvingOwn && !isOwnProfile;

  const viewed = useQuery({
    queryKey: viewedUserKey(userId),
    queryFn: () => fetchPublicProfile(userId),
    enabled: readsPublicProfile,
  });

  /**
   * The follow set is read here rather than inside the button, in parallel with
   * the profile: the two are rendered together, so fetching them in sequence
   * would show the counts while the button was still guessing. Never asked
   * without a session — an anonymous read of it is a 401.
   */
  const readsFollowSet = readsPublicProfile && status === "authenticated";
  const followSet = useQuery({
    queryKey: FOLLOWING_QUERY_KEY,
    queryFn: fetchFollowing,
    enabled: readsFollowSet,
  });

  if (!Number.isInteger(userId)) {
    return <p role="alert">There is no profile at this address.</p>;
  }
  if (ownProfile !== null && ownProfile.id === userId) {
    return <OwnProfile profile={ownProfile} />;
  }
  if (resolvingOwn || viewed.isPending || (readsFollowSet && followSet.isPending)) {
    return <p role="status">Loading this profile…</p>;
  }
  if (viewed.isError || viewed.data === undefined) {
    return <p role="alert">We could not load this profile just now. Please try again.</p>;
  }
  return (
    <PublicProfile
      profile={viewed.data}
      isFollowing={(followSet.data ?? []).includes(userId)}
    />
  );
}
