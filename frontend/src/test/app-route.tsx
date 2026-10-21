import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { RequestHandler } from "msw";
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
import { statsDefaults } from "./stats";
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
 * teams are the same `GET /events/teams`), the stats and player routes' reads
 * (`statsDefaults`, `FRONTEND-009`), and (signed in) the follow set. Nothing
 * the shell's tests assert depends on them.
 */
export function arrangeVisitor(as: Visitor): AuthService {
  server.use(publicProfilesById(), teamsAre(), emptyFeed());
  server.use(notificationsAre([]), preferenceIs(true));
  server.use(gameFiltersAre());
  server.use(...statsDefaults());
  if (as === "anonymous") return new FakeAuthService();

  server.use(as === "member" ? profileFound() : profileMissing());
  // A signed-in visit to someone else's profile reads the follow set too.
  server.use(followingStub().handler);
  return new FakeAuthService({ session: testSession() });
}

export type AppRouter = ReturnType<typeof createMemoryRouter>;

/**
 * `handlers` are installed after the visitor's defaults, so they win: a test
 * that asserts on a read passes its own stub here rather than racing the
 * defaults with a `server.use` of its own. The memory router is returned
 * beside the render result, so a test can read the address
 * (`router.state.location`) and go Back (`router.navigate(-1)`).
 */
export function renderAppAt(
  path: string,
  as: Visitor,
  handlers: RequestHandler[] = [],
): RenderResult & { router: AppRouter } {
  return renderAppWithHistory({ initialEntries: [path] }, as, handlers);
}

/** A memory history of more than one entry, for `renderAppWithHistory`. */
export interface AppHistory {
  initialEntries: string[];
  /** The entry the app starts on; the last one when omitted. */
  initialIndex?: number;
}

/**
 * `renderAppAt` with a history of several entries, so a test can start the app
 * on an entry that has others before it — e.g. `["/unrelated", "/posts/5"]`
 * at index 1, a direct load of a thread with somebody else's page behind it,
 * which no way out of the thread modal may ever reach (`FRONTEND-011`).
 */
export function renderAppWithHistory(
  history: AppHistory,
  as: Visitor,
  handlers: RequestHandler[] = [],
): RenderResult & { router: AppRouter } {
  const authService = arrangeVisitor(as);
  if (handlers.length > 0) server.use(...handlers);
  const router = createMemoryRouter(routes, {
    initialEntries: history.initialEntries,
    initialIndex: history.initialIndex,
  });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider authService={authService}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...result, router };
}
