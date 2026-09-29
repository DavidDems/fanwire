/**
 * The feed is wired into the route table, and `/` is still public.
 *
 * `src/routes/routes.test.tsx` already pins that *something* with the heading
 * `Feed` renders at `/` for an anonymous visitor. What it cannot pin — because it
 * predates this unit — is that the thing rendering there is the real feed rather
 * than the placeholder in `routes/views.tsx`, whose heading is the same word.
 * Without this file a unit could build a perfect feed that no route points at
 * and every test would still be green; the same gap `ComposeRoute.test.tsx`
 * closed for `FRONTEND-004`.
 *
 * That other file is edited here only to add a `GET /feed` handler to its
 * `arrange()` helper, because msw runs with `onUnhandledRequest: "error"` and
 * every route case in it renders the shell. Nothing in it asserts on the feed,
 * and the heading it pins (`/^feed$/i`) is a contract this unit satisfies rather
 * than renegotiates.
 *
 * Criterion 2 is also visible from here, at the route level: the same address
 * renders the same component for a visitor with no session and for one with a
 * session and a profile.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AuthProvider } from "../../auth/AuthContext";
import type { AuthService } from "../../auth/AuthService";
import { FakeAuthService, profileFound, testSession } from "../../test/auth";
import { feedPage, feedStub, testPostView } from "../../test/feed";
import { routes } from "../../routes/routes";
import { server } from "../../test/server";

const POST_TEXT = "Tip-off in ten minutes";
const POST = testPostView({ id: 501, text: POST_TEXT });

/** A line only the placeholder view renders, so the two can be told apart. */
const PLACEHOLDER_COPY = /posts land here/i;

function renderAt(path: string, authService: AuthService) {
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

describe("/", () => {
  it("renders the real feed for an anonymous visitor, under the pinned heading", async () => {
    const feed = feedStub([feedPage([POST], null)]);
    server.use(feed.handler);

    renderAt("/", new FakeAuthService());

    expect(await screen.findByRole("heading", { name: /^feed$/i })).toBeInTheDocument();
    expect(await screen.findByText(POST_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(PLACEHOLDER_COPY)).toBeNull();
    expect(feed.requests).toHaveLength(1);
  });

  it("renders the same feed for a signed-in member", async () => {
    // `profileFound` is for the shell, which links "Your profile" by id — not
    // for the feed, which asks for no profile of either kind.
    const feed = feedStub([feedPage([POST], null)]);
    server.use(feed.handler, profileFound());

    renderAt("/", new FakeAuthService({ session: testSession() }));

    expect(await screen.findByRole("heading", { name: /^feed$/i })).toBeInTheDocument();
    expect(await screen.findByText(POST_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(PLACEHOLDER_COPY)).toBeNull();
  });

  it("stays public", async () => {
    // The guest feed is a read path by decision ([[0x06-feed]] Security,
    // [[0x08-frontend]] — a guard on `/` is a regression).
    const feed = feedStub([feedPage([POST], null)]);
    server.use(feed.handler);

    renderAt("/", new FakeAuthService());

    await screen.findByText(POST_TEXT);
    expect(screen.queryByRole("heading", { name: /^sign\s*-?\s*in$/i })).toBeNull();
  });
});
