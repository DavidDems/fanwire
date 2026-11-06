/**
 * FRONTEND-033 — the profile route's own loading fallback, through the real
 * route table.
 *
 * Measured before the change (PR): React Router runs every navigation in a
 * transition, and the lazy `ProfilePage` chunk suspended behind
 * `BackgroundRoutes`' one Suspense — a boundary already showing the feed. React
 * keeps an already-revealed boundary's content during a transition, so the
 * URL changed and the feed stayed on screen, with no feedback, until the chunk
 * arrived. A Suspense of the profile route's own is mounted fresh by the
 * navigation, and a fresh boundary shows its fallback at once.
 *
 * Here `ProfilePage` is replaced by a page that suspends for ever — a chunk
 * that has not arrived — and everything else in the module is the real one, so
 * a fallback that lives beside the page is still found. The navigation is the
 * router's own (`router.navigate`, a transition), from a feed that is already
 * on screen.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../../auth/AuthContext";
import { FakeAuthService, teamsAre } from "../../test/auth";
import { emptyFeed } from "../../test/feed";
import { server } from "../../test/server";
import { publicProfilesById } from "../../test/users";
import { routes } from "../../routes/routes";

vi.mock("./ProfilePage", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const never = new Promise<never>(() => {});
  return {
    ...actual,
    ProfilePage: function SuspendedProfilePage(): never {
      throw never;
    },
  };
});

/** The one announced loading line, the same as the page's own data wait. */
const LOADING_TEXT = "Loading this profile…";

function renderApp(path: string) {
  server.use(publicProfilesById(), teamsAre(), emptyFeed());
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider authService={new FakeAuthService()}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return router;
}

// `globals: false`, so Testing Library never registers its own auto-cleanup.
afterEach(cleanup);

describe("the profile route while its page is not ready", () => {
  it("replaces the feed with the profile loading state as soon as the address changes", async () => {
    const router = renderApp("/");
    const main = await screen.findByRole("main");
    await within(main).findByRole("heading", { name: /^feed$/i });
    const focused = document.activeElement;

    await act(async () => {
      void router.navigate("/profile/42");
      await Promise.resolve();
    });

    expect(router.state.location.pathname).toBe("/profile/42");
    const line = await within(main).findByText(
      LOADING_TEXT,
      {},
      { timeout: 500 },
    );
    expect(line.closest('[role="status"]')).not.toBeNull();
    expect(within(main).queryByRole("heading", { name: /^feed$/i })).toBeNull();
    expect(document.activeElement).toBe(focused);
  });

  it("shows the profile loading state on a direct load too", async () => {
    renderApp("/profile/42");
    const main = await screen.findByRole("main");

    const line = await within(main).findByText(LOADING_TEXT);
    expect(line.closest('[role="status"]')).not.toBeNull();
  });
});
