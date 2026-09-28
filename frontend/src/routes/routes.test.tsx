/**
 * FRONTEND-001 acceptance criterion 8 — the router shell.
 * FRONTEND-002 acceptance criteria 4, 5 and 6 — the guards, in the table.
 *
 * The shell is what lets the remaining units be independent: each one fills in
 * a route that already exists and already has a place in the navigation. So
 * what is pinned is the route table itself — every path resolves to a view,
 * every view is distinguishable from the others, and an unmatched path lands
 * on the app's own not-found view.
 *
 * Views are identified by their heading's accessible name, per the repo's
 * query rules (roles and labels, never a test id). Placeholders are expected for
 * the routes their own unit has not landed yet; a placeholder still has to be
 * the *right* placeholder.
 *
 * **What FRONTEND-002 changed here, deliberately.** `/compose` and
 * `/notifications` no longer render their views to anybody who asks: they are
 * behind `RequireAuth`, so reaching them takes a session *and* a profile. The
 * table therefore says, per route, which of the three guard states makes that
 * route the one that renders — and the new `/create-profile` route is the one
 * that only a signed-in visitor without a profile can see. Everything the
 * original file pinned that is still true is still pinned: the same paths, the
 * same distinct-view sweep, the same app-owned catch-all.
 *
 * Nothing here mocks the Cognito SDK. The session comes from a double of the
 * `AuthService` interface, and `GET /users/me` comes from msw.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { AuthProvider } from "../auth/AuthContext";
import type { AuthService } from "../auth/AuthService";
import { FakeAuthService, profileFound, profileMissing, teamsAre, testSession } from "../test/auth";
import { server } from "../test/server";
import { routes } from "./routes";

/**
 * Which guard state makes a route the one that renders.
 *
 * - `anonymous` — no session at all. The public routes, and the auth pages.
 * - `member` — a session, and `GET /users/me` answers 200.
 * - `newcomer` — a session, and `GET /users/me` answers 404: confirmed in
 *   Cognito, no profile row yet.
 */
type Visitor = "anonymous" | "member" | "newcomer";

interface View {
  path: string;
  heading: RegExp;
  as: Visitor;
}

const VIEWS: View[] = [
  { path: "/", heading: /^feed$/i, as: "anonymous" },
  { path: "/search", heading: /^search$/i, as: "anonymous" },
  { path: "/profile/42", heading: /^profile$/i, as: "anonymous" },
  { path: "/sign-in", heading: /^sign\s*-?\s*in$/i, as: "anonymous" },
  { path: "/sign-up", heading: /^sign\s*-?\s*up$/i, as: "anonymous" },
  { path: "/confirm", heading: /^confirm/i, as: "anonymous" },
  {
    path: "/forgot-password",
    heading: /^forgot\s*-?\s*password$/i,
    as: "anonymous",
  },
  {
    path: "/no-such-page-exists",
    heading: /^not\s*-?\s*found$/i,
    as: "anonymous",
  },
  { path: "/compose", heading: /^compose$/i, as: "member" },
  { path: "/notifications", heading: /^notifications$/i, as: "member" },
  {
    path: "/create-profile",
    heading: /^create your profile$/i,
    as: "newcomer",
  },
];

/** Install the API responses that visitor implies, and return their session. */
function arrange(as: Visitor): AuthService {
  if (as === "anonymous") return new FakeAuthService();

  server.use(as === "member" ? profileFound() : profileMissing(), teamsAre());
  return new FakeAuthService({ session: testSession() });
}

function renderAt(path: string, authService: AuthService) {
  // A memory router per render: the route table is what is under test, and
  // each case needs its own history. A QueryClientProvider wraps it so that a
  // route view is free to use react-query without this test caring, and an
  // AuthProvider wraps that because the guards in the table read a session.
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider authService={authService}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function renderView(view: View) {
  return renderAt(view.path, arrange(view.as));
}

// `globals: false`, so Testing Library never registers its own auto-cleanup.
afterEach(cleanup);

describe("the route table", () => {
  it.each(VIEWS)("renders a view at $path for a $as visitor", async (view) => {
    renderView(view);

    expect(await screen.findByRole("heading", { name: view.heading })).toBeInTheDocument();
  });

  it("renders the user id from the /profile/:userId segment", async () => {
    renderAt("/profile/42", arrange("anonymous"));

    await screen.findByRole("heading", { name: /^profile$/i });
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it("renders a distinct view for every route", async () => {
    for (const view of VIEWS) {
      renderView(view);
      await screen.findByRole("heading", { name: view.heading });

      for (const other of VIEWS) {
        if (other.path === view.path) continue;
        expect(
          screen.queryAllByRole("heading", { name: other.heading }),
          `${view.path} must not render the ${other.path} view`,
        ).toHaveLength(0);
      }
      cleanup();
    }
  });

  it("renders the app's own not-found view, not react-router's error boundary", async () => {
    // Without a catch-all route, react-router renders its built-in error
    // element, whose "404 Not Found" heading would satisfy the check above
    // while the app itself has no not-found view at all.
    renderAt("/no-such-page-exists", arrange("anonymous"));

    await screen.findByRole("heading", { name: /^not\s*-?\s*found$/i });
    expect(screen.queryByText(/unexpected application error/i)).toBeNull();
  });
});

describe("the guards are wired into the table, not just written", () => {
  it("sends an anonymous visitor from a protected route to sign-in", async () => {
    for (const path of ["/compose", "/notifications"]) {
      renderAt(path, arrange("anonymous"));

      expect(
        await screen.findByRole("heading", { name: /^sign\s*-?\s*in$/i }),
        `${path} must not be reachable without a session`,
      ).toBeInTheDocument();
      cleanup();
    }
  });

  it("sends a signed-in visitor with no profile from a protected route to profile creation", async () => {
    renderAt("/compose", arrange("newcomer"));

    expect(
      await screen.findByRole("heading", { name: /^create your profile$/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^compose$/i })).toBeNull();
  });

  it("sends a visitor who already has a profile away from profile creation", async () => {
    renderAt("/create-profile", arrange("member"));

    expect(await screen.findByRole("heading", { name: /^feed$/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^create your profile$/i })).toBeNull();
  });

  it("leaves the public routes public", async () => {
    // The guest feed and public profiles are read paths by decision
    // ([[0x01-users]] Security). A guard on either of these is a regression.
    const publicViews = VIEWS.filter((view) => view.as === "anonymous" && view.path !== "/sign-in");

    for (const view of publicViews) {
      renderAt(view.path, arrange("anonymous"));
      await screen.findByRole("heading", { name: view.heading });

      expect(
        screen.queryByRole("heading", { name: /^sign\s*-?\s*in$/i }),
        `${view.path} must stay reachable signed out`,
      ).toBeNull();
      cleanup();
    }
  });
});
