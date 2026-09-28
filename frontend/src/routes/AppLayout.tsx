import { Link, Outlet } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { useProfile } from "../auth/profile";

/**
 * The shell every route renders inside: primary navigation, and the one `main`
 * landmark the route's view is rendered into.
 *
 * Deliberately unstyled and minimal — this is the frame the next six units fill
 * in, not a design.
 *
 * "Your profile" is built from the signed-in user's id, because `/profile/:userId`
 * has no fixed address for "me" and without this link there is no way to reach
 * the own-profile variant from inside the app. It is rendered only for a visitor
 * who has a profile: an anonymous one has no id to link to, and a signed-in one
 * whose `GET /users/me` is a 404 has no profile row yet — the state
 * `RequireNewProfile` exists for, and `/profile/undefined` is the bug it
 * prevents. The profile is read through the one shared query, gated on the
 * session exactly as the guards gate it, so the shell asks the API nothing until
 * somebody signs in.
 */
export function AppLayout() {
  const { status } = useAuth();
  const profile = useProfile(status === "authenticated");
  const ownUserId = status === "authenticated" ? (profile.data?.id ?? null) : null;

  return (
    <>
      <header>
        <nav aria-label="Primary">
          <ul>
            <li>
              <Link to="/">Feed</Link>
            </li>
            <li>
              <Link to="/compose">Compose</Link>
            </li>
            <li>
              <Link to="/notifications">Notifications</Link>
            </li>
            <li>
              <Link to="/search">Search</Link>
            </li>
            {ownUserId === null ? null : (
              <li>
                <Link to={`/profile/${ownUserId}`}>Your profile</Link>
              </li>
            )}
          </ul>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
