/**
 * FRONTEND-001 acceptance criterion 8 — the router shell.
 *
 * The shell is what lets the next six units be independent: each one fills in
 * a route that already exists and already has a place in the navigation. So
 * what is pinned is the route table itself — every path resolves to a view,
 * every view is distinguishable from the others, and an unmatched path lands
 * on the app's own not-found view.
 *
 * Views are identified by their heading's accessible name, per the repo's
 * query rules (roles and labels, never a test id). Placeholders are expected at
 * this stage; a placeholder still has to be the *right* placeholder.
 *
 * Route names: the criterion names `/`, `/compose`, `/notifications`,
 * `/search`, `/profile/:userId` and "the auth routes" without spelling the
 * last group out. The four below are FRONTEND-002's pages (sign-up, confirm,
 * sign-in, forgot password), written the way the wiki writes them.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { routes } from "./routes";

interface View {
  path: string;
  heading: RegExp;
}

const VIEWS: View[] = [
  { path: "/", heading: /feed/i },
  { path: "/compose", heading: /compose/i },
  { path: "/notifications", heading: /notifications/i },
  { path: "/search", heading: /search/i },
  { path: "/profile/42", heading: /profile/i },
  { path: "/sign-in", heading: /sign\s*-?\s*in/i },
  { path: "/sign-up", heading: /sign\s*-?\s*up/i },
  { path: "/confirm", heading: /confirm/i },
  { path: "/forgot-password", heading: /forgot\s*-?\s*password/i },
  { path: "/no-such-page-exists", heading: /not\s*-?\s*found/i },
];

function renderAt(path: string) {
  // A memory router per render: the route table is what is under test, and
  // each case needs its own history. A QueryClientProvider wraps it so that a
  // route view is free to use react-query without this test caring.
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

// `globals: false`, so Testing Library never registers its own auto-cleanup.
afterEach(cleanup);

describe("the route table", () => {
  it.each(VIEWS)("renders a view at $path", async ({ path, heading }) => {
    renderAt(path);

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
  });

  it("renders the user id from the /profile/:userId segment", async () => {
    renderAt("/profile/42");

    await screen.findByRole("heading", { name: /profile/i });
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it("renders a distinct view for every route", async () => {
    for (const view of VIEWS) {
      renderAt(view.path);
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
    renderAt("/no-such-page-exists");

    await screen.findByRole("heading", { name: /not\s*-?\s*found/i });
    expect(screen.queryByText(/unexpected application error/i)).toBeNull();
  });
});
