/**
 * FRONTEND-002 acceptance criteria 4, 5, 6 and 7, end to end through the real
 * route table.
 *
 * `guards.test.tsx` pins each guard against stub destinations. This pins the
 * two journeys those stubs stand in for, through the routes the app actually
 * ships — because a guard that works and a route table that never uses it both
 * pass every test in that file.
 *
 * The query client here mirrors `App.tsx`'s (`staleTime: 30_000`) rather than
 * the test default of zero. With a zero stale time every remount refetches, so
 * the second journey below would pass whether or not the profile lookup is
 * invalidated after `POST /users` — and in the real app it would bounce the
 * user who just created a profile straight back to the form.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { components } from "../api/schema";
import { AuthProvider } from "../auth/AuthContext";
import type { AuthService } from "../auth/AuthService";
import {
  FakeAuthService,
  TEST_EMAIL,
  TEST_PASSWORD,
  profileFound,
  teamsAre,
  testProfile,
  testSession,
} from "../test/auth";
import { server } from "../test/server";
import { routes } from "./routes";

type MeOut = components["schemas"]["MeOut"];

function renderApp(path: string, authService: AuthService) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });

  // `AuthProvider` outside `RouterProvider`, the way `App` mounts it: the
  // session does not belong to a route, and the provider must not need router
  // context to exist.
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider authService={authService}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

/** `GET /users/me`: 404 until `POST /users` succeeds, 200 afterwards. */
function profileCreatedOnDemand(): void {
  let exists = false;
  server.use(
    http.get("*/users/me", () =>
      exists
        ? HttpResponse.json<MeOut>(testProfile())
        : HttpResponse.json({ detail: "Not Found" }, { status: 404 }),
    ),
    http.post("*/users", () => {
      exists = true;
      return HttpResponse.json<MeOut>(testProfile(), { status: 201 });
    }),
  );
}

describe("an anonymous visitor asking for a protected route", () => {
  it("is sent to sign-in and then on to the route they asked for", async () => {
    const user = userEvent.setup();
    server.use(profileFound());

    renderApp("/compose", new FakeAuthService());

    // Sign-in, because /compose needs a session.
    await screen.findByRole("heading", { name: /sign\s*-?\s*in/i });
    expect(screen.queryByRole("heading", { name: /^compose$/i })).toBeNull();

    await user.type(screen.getByLabelText(/^email$/i), TEST_EMAIL);
    await user.type(screen.getByLabelText(/^password$/i), TEST_PASSWORD);
    await user.click(screen.getByRole("button", { name: /sign\s*-?\s*in/i }));

    // …and on to /compose, not to the feed.
    expect(await screen.findByRole("heading", { name: /^compose$/i })).toBeInTheDocument();
  });
});

describe("a confirmed account with no profile yet", () => {
  it("is routed to profile creation, creates one, and can then reach the protected route", async () => {
    const user = userEvent.setup();
    profileCreatedOnDemand();
    server.use(teamsAre());

    renderApp("/compose", new FakeAuthService({ session: testSession() }));

    // 404 from GET /users/me is a routing state, not an error.
    await screen.findByRole("heading", { name: /create your profile/i });
    expect(screen.queryByRole("alert")).toBeNull();

    await user.type(screen.getByLabelText(/^username$/i), "raptorsfan");
    fireEvent.change(screen.getByLabelText(/date of birth/i), {
      target: { value: "1994-04-05" },
    });
    await user.click(screen.getByRole("button", { name: /create profile/i }));

    // The feed, and no longer the form.
    await screen.findByRole("heading", { name: /^feed$/i });
    expect(screen.queryByRole("heading", { name: /create your profile/i })).toBeNull();

    // And the route that sent them here is now reachable — the stale 404 must
    // not survive the profile that answered it.
    await user.click(screen.getByRole("link", { name: /^compose$/i }));

    expect(await screen.findByRole("heading", { name: /^compose$/i })).toBeInTheDocument();
  });

  it("cannot reach profile creation once a profile exists", async () => {
    server.use(profileFound(), teamsAre());

    renderApp("/create-profile", new FakeAuthService({ session: testSession() }));

    expect(await screen.findByRole("heading", { name: /^feed$/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /create your profile/i })).toBeNull();
  });
});
