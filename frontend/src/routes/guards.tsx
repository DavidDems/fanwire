import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAccount } from "../auth/account";
import { useAuth } from "../auth/AuthContext";
import { RecoveryScreen } from "./Deactivated";

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
 * | session, `GET /users/me` 403 `account_deactivated` | the recovery screen, on that route (`FRONTEND-012`) |
 *
 * `RequireNewProfile` is the same table read backwards, and it is what stops
 * profile creation being reachable by someone who already has one.
 *
 * There is a fourth state neither of those rows names: "we do not know yet".
 * Both guards render a loading status while the session or the profile is
 * unresolved, because the alternative — guessing — is what shows a signed-in
 * user the sign-in page on every reload.
 *
 * Both guards read the account state from `useAccount()` (`auth/account.ts`),
 * which reads the one shared profile query, so a redirect between them costs no
 * second request and cannot see two different answers.
 *
 * **A deactivated account** (`FRONTEND-012`) is not sent anywhere: a signed-in
 * route shows the recovery screen in its place, so recovering lands on the
 * route that was asked for, and profile creation sends it to the feed (it has a
 * profile; creation is never offered to it).
 */

function Resolving({ label }: { label: string }) {
  // Named, not a bare spinner: `role="status"` with no text is invisible to a
  // screen reader and useless to the next person debugging a hang.
  return <p role="status">{label}</p>;
}

function Unavailable() {
  return (
    <p role="alert">
      We could not check your profile just now. Please reload the page in a
      moment.
    </p>
  );
}

export interface GuardProps {
  children: ReactNode;
}

/** A route that needs a session *and* a profile. */
export function RequireAuth({ children }: GuardProps) {
  const account = useAccount();
  const sessionKnown = useAuth().status !== "loading";
  const location = useLocation();

  switch (account.status) {
    case "loading":
      return (
        <Resolving
          label={resolvingLabel(sessionKnown, "Loading your profile…")}
        />
      );
    case "anonymous":
      // `from` is what `SignInPage` reads to send them on afterwards. Landing
      // everyone on the feed is the defect this carries the state to avoid.
      return <Navigate to="/sign-in" state={{ from: location }} replace />;
    case "unavailable":
      return <Unavailable />;
    case "no-profile":
      // 404: authenticated, no profile row yet. A routing state, not an error
      // view.
      return <Navigate to="/create-profile" replace />;
    case "deactivated":
      return <RecoveryScreen />;
    case "active":
      return <>{children}</>;
  }
}

/** The profile-creation route: a session, and deliberately *no* profile yet. */
export function RequireNewProfile({ children }: GuardProps) {
  const account = useAccount();
  const sessionKnown = useAuth().status !== "loading";
  const location = useLocation();

  switch (account.status) {
    case "loading":
      return (
        <Resolving
          label={resolvingLabel(
            sessionKnown,
            "Checking whether you have a profile…",
          )}
        />
      );
    case "anonymous":
      return <Navigate to="/sign-in" state={{ from: location }} replace />;
    case "unavailable":
      return <Unavailable />;
    case "no-profile":
      return <>{children}</>;
    case "active":
    case "deactivated":
      // Both have a profile: a deactivated one is recovered, never re-created.
      return <Navigate to="/" replace />;
  }
}

/** Which half is still unresolved: the session, or (once there is one) the profile. */
function resolvingLabel(sessionKnown: boolean, profileLabel: string): string {
  return sessionKnown ? profileLabel : "Checking your session…";
}
