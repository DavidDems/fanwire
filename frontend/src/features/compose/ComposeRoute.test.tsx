/**
 * The composer is wired into the route table, and `/compose` is still protected.
 *
 * `src/routes/routes.test.tsx` already pins that *something* with the heading
 * `Compose` renders at `/compose` for a `member` visitor and that an anonymous
 * visitor is sent to sign-in. What it cannot pin — because it predates this
 * unit — is that the thing rendering there is the real composer rather than the
 * placeholder from `views.tsx`. Without this file a unit could build a perfect
 * composer that no route points at, and every test would still be green.
 *
 * That other file is deliberately not edited: `FRONTEND-003` is changing it
 * concurrently, and the heading it pins (`/^compose$/i`) is a contract this
 * unit satisfies rather than renegotiates.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AuthProvider } from "../../auth/AuthContext";
import type { AuthService } from "../../auth/AuthService";
import { FakeAuthService, profileFound, testSession } from "../../test/auth";
import { server } from "../../test/server";
import { routes } from "../../routes/routes";

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

describe("/compose", () => {
  it("renders the real composer for a signed-in member, under the pinned heading", async () => {
    server.use(profileFound());

    renderAt("/compose", new FakeAuthService({ session: testSession() }));

    expect(await screen.findByRole("heading", { name: /^compose$/i })).toBeInTheDocument();
    // The placeholder had no controls at all. These are the composer's.
    expect(screen.getByRole("textbox", { name: /post/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^post$/i })).toBeInTheDocument();
  });

  it("stays behind RequireAuth", async () => {
    renderAt("/compose", new FakeAuthService());

    expect(await screen.findByRole("heading", { name: /^sign\s*-?\s*in$/i })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /post/i })).toBeNull();
  });
});
