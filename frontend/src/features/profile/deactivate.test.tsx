/**
 * FRONTEND-012 criterion 8 — deactivating the account from the own-profile
 * settings (`USERS-003`'s `DELETE /users/me`).
 *
 * - **Where**: an "Account" section at the end of the settings card, holding a
 *   "Deactivate account" button. No new route.
 * - **Asks first**: an `alertdialog` (named for deactivating) that says what
 *   it does — the posts are hidden until the account is recovered, and posts
 *   deleted one by one stay deleted — with Cancel focused.
 * - **Then**: one `DELETE /users/me`. On its 204 everything the viewer saw as
 *   a member is stale (their feed, liked and reposted flags, the follow set),
 *   so the react-query cache is cleared — but not the session: they stay
 *   signed in — `GET /users/me` is read again, and the app shows the
 *   deactivated state (`routes/deactivated.test.tsx` pins that state; here,
 *   its banner is the sign that the app got there).
 *
 * Through the real route table: the deactivated state is the whole app's.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  accountServer,
  deactivatedShown,
  queryDeactivatedBanner,
} from "../../test/account";
import { OWN_USER_ID, renderAppAt } from "../../test/app-route";
import type { FakeAuthService } from "../../test/auth";
import { feedPage } from "../../test/feed";
import { FEED_PAGES_KEY } from "../feed/api";
import { FOLLOWING_QUERY_KEY } from "./api";

async function openOwnProfile() {
  const user = userEvent.setup();
  const account = accountServer("active");
  const app = renderAppAt(
    `/profile/${OWN_USER_ID}`,
    "member",
    account.handlers,
  );
  const settingsHeading = await screen.findByRole("heading", {
    name: "Settings",
  });
  const settings = settingsHeading.closest("section");
  if (settings === null)
    throw new Error("the Settings heading is in no section");
  return { user, app, account, settings };
}

async function openConfirm() {
  const opened = await openOwnProfile();
  await opened.user.click(
    within(opened.settings).getByRole("button", { name: "Deactivate account" }),
  );
  const confirm = await screen.findByRole("alertdialog", {
    name: /deactivate/i,
  });
  return { ...opened, confirm };
}

function confirmButton(confirm: HTMLElement): HTMLElement {
  return within(confirm).getByRole("button", {
    name: /^deactivate( account)?$/i,
  });
}

describe("the Account section of the own-profile settings", () => {
  it("is the last thing in the settings card, after the form", async () => {
    const { settings } = await openOwnProfile();

    const heading = within(settings).getByRole("heading", { name: "Account" });
    const form = settings.querySelector("form");
    expect(form).not.toBeNull();
    expect(
      (form as HTMLFormElement).compareDocumentPosition(heading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      "Account comes after the profile form",
    ).toBeTruthy();
    expect(form?.contains(heading)).toBe(false);
  });

  it("holds a Deactivate account button, outside the profile form", async () => {
    const { settings } = await openOwnProfile();

    const button = within(settings).getByRole("button", {
      name: "Deactivate account",
    });
    expect(button).toHaveAttribute("type", "button");
    expect(button.closest("form")).toBeNull();
  });

  it("is not on someone else's profile", async () => {
    renderAppAt("/profile/42", "member");
    await screen.findByRole("heading", { name: /courtside42/ });

    expect(
      screen.queryByRole("button", { name: "Deactivate account" }),
    ).toBeNull();
  });
});

describe("deactivating asks first", () => {
  it("opens an alertdialog saying what deactivating does, focus on Cancel", async () => {
    const { confirm } = await openConfirm();

    const text = confirm.textContent ?? "";
    expect(text).toMatch(/hidden/i);
    expect(text).toMatch(/recover/i);
    expect(text, "individually deleted posts stay deleted").toMatch(/deleted/i);
    expect(confirmButton(confirm)).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(confirm).getByRole("button", { name: "Cancel" }),
      ).toHaveFocus(),
    );
  });

  it("Cancel sends nothing and leaves the account as it was", async () => {
    const { user, confirm, account } = await openConfirm();

    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(account.deactivations).toEqual([]);
    expect(queryDeactivatedBanner()).toBeNull();
  });
});

describe("confirming deactivates the account", () => {
  it("sends DELETE /users/me once", async () => {
    const { user, confirm, account } = await openConfirm();

    await user.click(confirmButton(confirm));

    await waitFor(() => expect(account.deactivations).toHaveLength(1));
  });

  it("reads GET /users/me again and shows the deactivated state", async () => {
    const { user, confirm, account } = await openConfirm();
    const reads = account.meRequests.length;

    await user.click(confirmButton(confirm));

    await waitFor(() =>
      expect(account.meRequests.length).toBeGreaterThan(reads),
    );
    await deactivatedShown();
  });

  it("clears what the member saw (the feed, the follow set) but keeps the session", async () => {
    const { user, app, confirm } = await openConfirm();
    app.queryClient.setQueryData(FEED_PAGES_KEY, {
      pages: [feedPage([], null)],
      pageParams: [null],
    });
    app.queryClient.setQueryData(FOLLOWING_QUERY_KEY, [42]);

    await user.click(confirmButton(confirm));
    await deactivatedShown();

    expect(app.queryClient.getQueryData(FEED_PAGES_KEY)).toBeUndefined();
    // Gone, or read again from the server since: never the member's old copy.
    expect(app.queryClient.getQueryData(FOLLOWING_QUERY_KEY)).not.toEqual([42]);
    expect(
      (app.authService as FakeAuthService).callsTo("signOut"),
      "deactivating is not signing out",
    ).toEqual([]);
    expect(screen.queryByRole("link", { name: /^sign in$/i })).toBeNull();
  });
});
