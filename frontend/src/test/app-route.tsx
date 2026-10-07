import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";

import { AuthProvider } from "../auth/AuthContext";
import type { AuthService } from "../auth/AuthService";
import { routes } from "../routes/routes";
import {
  FakeAuthService,
  profileFound,
  profileMissing,
  teamsAre,
  testProfile,
  testSession,
} from "./auth";
import { emptyFeed } from "./feed";
import { notificationsAre, preferenceIs } from "./notifications";
import { gameFiltersAre } from "./search";
import { server } from "./server";
import { followingStub, publicProfilesById } from "./users";

/**
 * The whole app at one path, through the real route table, for a given kind of
 * visitor — the shell's tests render every route this way, because the shell
 * is what every route shares.
 *
 * Mounted the way `App` mounts it (`AuthProvider` outside `RouterProvider`),
 * mirroring `routes/routes.test.tsx`, whose helpers live in a test file and so
 * cannot be imported.
 *
 * - `anonymous` — no session at all.
 * - `member` — a session, and `GET /users/me` answers 200 with `testProfile()`.
 * - `newcomer` — a session, and `GET /users/me` answers 404.
 */
export type Visitor = "anonymous" | "member" | "newcomer";

/** The signed-in member's own id, so `/profile/${OWN_USER_ID}` is their own profile. */
export const OWN_USER_ID = testProfile().id;

/**
 * Install the API responses that visitor implies, and return their session.
 *
 * Every read any route makes on mount is answered for every visitor (msw runs
 * with `onUnhandledRequest: "error"`): the feed, public profiles, teams, and
 * the notification list and preference, the search page's game filters (its
 * teams are the same `GET /events/teams`), and (signed in) the follow set.
 * Nothing the shell's tests assert depends on them.
 */
export function arrangeVisitor(as: Visitor): AuthService {
  server.use(publicProfilesById(), teamsAre(), emptyFeed());
  server.use(notificationsAre([]), preferenceIs(true));
  server.use(gameFiltersAre());
  if (as === "anonymous") return new FakeAuthService();

  server.use(as === "member" ? profileFound() : profileMissing());
  // A signed-in visit to someone else's profile reads the follow set too.
  server.use(followingStub().handler);
  return new FakeAuthService({ session: testSession() });
}

export function renderAppAt(path: string, as: Visitor): RenderResult {
  const authService = arrangeVisitor(as);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider authService={authService}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}
