import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { useProfile } from "../auth/profile";

/**
 * The route guards.
 *
 * Three states, and a guard has to tell them apart:
 *
 * | state                        | goes to                                  |
 * |------------------------------|------------------------------------------|
 * | no session                   | sign-in, remembering the requested route |
 * | session, `GET /users/me` 404 | profile creation                         |
 * | session, `GET /users/me` 200 | the route they asked for                 |
 *
 * `RequireNewProfile` is the same table read backwards, and it is what stops
 * profile creation being reachable by someone who already has one.
 *
 * There is a fourth state neither of those rows names: "we do not know yet".
 * Both guards render a loading status while the session or the profile is
 * unresolved, because the alternative — guessing — is what shows a signed-in
 * user the sign-in page on every reload.
 *
 * Both guards read the profile through the one shared query
 * (`auth/profile.ts`), so a redirect between them costs no second request and
 * cannot see two different answers.
 */

function Resolving({ label }: { label: string }) {
  // Named, not a bare spinner: `role="status"` with no text is invisible to a
  // screen reader and useless to the next person debugging a hang.
  return <p role="status">{label}</p>;
}

function Unavailable() {
  return (
    <p role="alert">
      We could not check your profile just now. Please reload the page in a moment.
    </p>
  );
}

export interface GuardProps {
  children: ReactNode;
}

/** A route that needs a session *and* a profile. */
export function RequireAuth({ children }: GuardProps) {
  const { status } = useAuth();
  const location = useLocation();
  // Never asked without a session: a profile lookup with no token is a 401 the
  // app would then have to explain away.
  const profile = useProfile(status === "authenticated");

  if (status === "loading") return <Resolving label="Checking your session…" />;
  if (status === "anonymous") {
    // `from` is what `SignInPage` reads to send them on afterwards. Landing
    // everyone on the feed is the defect this carries the state to avoid.
    return <Navigate to="/sign-in" state={{ from: location }} replace />;
  }

  if (profile.isPending) return <Resolving label="Loading your profile…" />;
  if (profile.isError) return <Unavailable />;
  // 404 -> `null`: authenticated, no profile row yet. A routing state, not an
  // error view.
  if (profile.data === null) return <Navigate to="/create-profile" replace />;

  return <>{children}</>;
}

/** The profile-creation route: a session, and deliberately *no* profile yet. */
export function RequireNewProfile({ children }: GuardProps) {
  const { status } = useAuth();
  const location = useLocation();
  const profile = useProfile(status === "authenticated");

  if (status === "loading") return <Resolving label="Checking your session…" />;
  if (status === "anonymous") {
    return <Navigate to="/sign-in" state={{ from: location }} replace />;
  }

  if (profile.isPending) return <Resolving label="Checking whether you have a profile…" />;
  if (profile.isError) return <Unavailable />;
  if (profile.data !== null) return <Navigate to="/" replace />;

  return <>{children}</>;
}
