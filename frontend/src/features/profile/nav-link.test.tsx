/**
 * FRONTEND-003 — reaching your own profile from the navigation.
 *
 * `/profile/:userId` has no fixed address for "me": the id in the path is the
 * only thing that selects the own-profile variant, so without a link built from
 * the signed-in user's id there is no way to get there from inside the app.
 *
 * It is rendered only for a visitor who has a profile. An anonymous visitor has
 * no id to link to, and a signed-in visitor whose `GET /users/me` is a 404 has
 * no profile row yet — that is the state `RequireNewProfile` exists for
 * ([[0x08-frontend]] Auth), and a link to `/profile/undefined` is the shape of
 * bug that state exists to prevent.
 *
 * This lives in the profile feature's own tests because `routes/AppLayout.tsx`
 * is the implementation's file to change, not the test agent's, and
 * `routes.test.tsx` pins the route table rather than the shell's contents.
 */
import { screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { AuthService } from "../../auth/AuthService";
import { AppLayout } from "../../routes/AppLayout";
import { FakeAuthService, renderWithAuth, testProfile, testSession } from "../../test/auth";
import { server } from "../../test/server";
import { meMissingStub, meStub } from "../../test/users";

const OWN_USER_ID = testProfile().id;

function renderLayout(authService: AuthService) {
  return renderWithAuth(
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<p>feed stub</p>} />
      </Route>
    </Routes>,
    { authService, route: "/" },
  );
}

describe("the primary navigation", () => {
  it("links a signed-in visitor to their own profile by id", async () => {
    server.use(meStub().handler);

    renderLayout(new FakeAuthService({ session: testSession() }));

    const link = await screen.findByRole("link", { name: /your profile/i });
    expect(link).toHaveAttribute("href", `/profile/${OWN_USER_ID}`);
  });

  it("offers no such link to an anonymous visitor, and asks the API nothing", async () => {
    const me = meStub();
    server.use(me.handler);

    renderLayout(new FakeAuthService());
    await screen.findByText("feed stub");

    expect(screen.queryByRole("link", { name: /your profile/i })).toBeNull();
    expect(me.requests).toEqual([]);
  });

  it("offers no such link to a signed-in visitor who has no profile row yet", async () => {
    const me = meMissingStub();
    server.use(me.handler);

    renderLayout(new FakeAuthService({ session: testSession() }));
    // Waited for rather than raced: asserting the link's absence before the 404
    // has even been asked for would pass against a layout that renders it.
    await waitFor(() => {
      expect(me.requests).toHaveLength(1);
    });

    expect(screen.queryByRole("link", { name: /your profile/i })).toBeNull();
  });
});
