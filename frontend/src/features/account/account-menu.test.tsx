/** USERS-006: the account menu replaces the primary-nav profile link. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useParams } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AppLayout } from "../../routes/AppLayout";
import {
  FakeAuthService,
  profileDeactivated,
  renderWithAuth,
  testSession,
} from "../../test/auth";
import { deactivatedShown } from "../../test/account";
import { server } from "../../test/server";
import { meMissingStub, meStub } from "../../test/users";

function renderLayout(authService: FakeAuthService) {
  return renderWithAuth(
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<p>Feed screen</p>} />
        <Route path="profile/:userId" element={<ProfileScreen />} />
        <Route path="history" element={<p>History screen</p>} />
        <Route path="settings" element={<p>Account settings screen</p>} />
      </Route>
    </Routes>,
    { authService, route: "/" },
  );
}

function ProfileScreen() {
  const { userId } = useParams();
  return <p>Profile {userId}</p>;
}

describe("the account menu", () => {
  it("offers the three account destinations from the avatar button", async () => {
    const user = userEvent.setup();
    server.use(meStub().handler);
    renderLayout(new FakeAuthService({ session: testSession() }));

    const button = await screen.findByRole("button", { name: "Account menu" });
    // The default test profile is "raptorsfan" with no preset, so Avatar draws "r".
    expect(button.querySelector('[aria-hidden="true"]')?.textContent).toBe("r");
    // FRONTEND-035: the menu sits at the header's end, and Sign out moved out
    // of the header into the Primary nav, which follows the header.
    const banner = screen.getByRole("banner");
    expect(banner).toContainElement(button);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(banner).not.toContainElement(nav);
    expect(nav).not.toContainElement(button);
    const signOut = within(nav).getByRole("button", { name: "Sign out" });
    expect(within(banner).queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(
      button.compareDocumentPosition(signOut) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(button);

    const menu = screen.getByRole("menu", { name: "Account menu" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Profile",
      "History",
      "Account settings",
    ]);
  });

  it.each([
    ["Profile", "Profile 7"],
    ["History", "History screen"],
    ["Account settings", "Account settings screen"],
  ])("opens %s", async (label, destination) => {
    const user = userEvent.setup();
    server.use(meStub().handler);
    renderLayout(new FakeAuthService({ session: testSession() }));
    await user.click(await screen.findByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("menuitem", { name: label }));

    expect(await screen.findByText(destination)).toBeInTheDocument();
  });

  it("opens by keyboard and returns focus to its button on Escape", async () => {
    const user = userEvent.setup();
    server.use(meStub().handler);
    renderLayout(new FakeAuthService({ session: testSession() }));
    const button = await screen.findByRole("button", { name: "Account menu" });

    button.focus();
    await user.keyboard("{ArrowDown}");
    const menu = screen.getByRole("menu", { name: "Account menu" });
    expect(within(menu).getByRole("menuitem", { name: "Profile" })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu", { name: "Account menu" })).toBeNull();
    expect(button).toHaveFocus();
  });

  it("is absent for an anonymous visitor", async () => {
    const me = meStub();
    server.use(me.handler);
    renderLayout(new FakeAuthService());
    await screen.findByText("Feed screen");

    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
    expect(me.requests).toEqual([]);
  });

  it("is absent for a signed-in visitor who has no profile", async () => {
    const me = meMissingStub();
    server.use(me.handler);
    renderLayout(new FakeAuthService({ session: testSession() }));
    await waitFor(() => expect(me.requests).toHaveLength(1));

    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
  });

  it("is absent for a deactivated account", async () => {
    server.use(profileDeactivated());
    renderLayout(new FakeAuthService({ session: testSession() }));
    await deactivatedShown();

    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
  });
});
