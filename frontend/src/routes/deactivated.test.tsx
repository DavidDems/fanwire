/**
 * FRONTEND-012 criteria 10, 11 and 12 — a signed-in account its owner
 * deactivated (`GET /users/me` → 403 `account_deactivated`, `USERS-003`).
 *
 * Decided by the human (2026-10-22): **gated on writes, not locked out.**
 *
 * - **Public pages browse as a guest** (criterion 10): like, repost, reply,
 *   follow and the menu's Report and Delete are absent or do exactly what they
 *   do for a guest — in particular, no write is ever sent, since every write
 *   would be a 403 — and Copy link, a read, stays.
 * - **Every page shows the banner**: a named `region` reading "Your account is
 *   deactivated", with a "Recover account" button and "Sign out". A region,
 *   never a second `<header>` (`accessibility.md` A12).
 * - **A signed-in-only route** (`RequireAuth`: compose, notifications) shows a
 *   recovery screen instead of its content (criterion 11): a heading, what
 *   recovery does (restores the account and its posts, not ones deleted
 *   individually), Recover account and Sign out. Profile creation is never
 *   offered to a deactivated account.
 * - **Recover** (criterion 12) is one `POST /users/me/recover`; on its 200
 *   every cached query is invalidated, the banner and the recovery screen go,
 *   and the page the viewer was on renders for an active member. A failure is
 *   an alert beside the button, and nothing else changes.
 *
 * The game and player pages' "Post about this" links are pinned beside their
 * signed-in and signed-out halves, in `features/games/post-about.test.tsx` and
 * `features/players/post-about.test.tsx`.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RequestHandler } from "msw";
import { describe, expect, it } from "vitest";

import {
  accountServer,
  deactivatedBanner,
  deactivatedShown,
  queryDeactivatedBanner,
} from "../test/account";
import { OWN_USER_ID, renderAppAt } from "../test/app-route";
import type { FakeAuthService } from "../test/auth";
import { gamesAre } from "../test/compose";
import {
  feedPage,
  likeStub,
  repostStub,
  testAuthor,
  testPostView,
  threadView,
} from "../test/feed";
import {
  feedServer,
  itemNames,
  openMenu,
  ownPost,
  reportStub,
  deletePostStub,
} from "../test/post-menu";
import { cardUnderneath, threadServer } from "../test/thread";
import { followStub } from "../test/users";

const THEIR_TEXT = "Raptors in six";
const OWN_TEXT = "My own take, from before";

const THEIRS = testPostView({
  id: 101,
  text: THEIR_TEXT,
  author: testAuthor({ id: 11, username: "courtside11" }),
});
const MINE = ownPost({ id: 301, text: OWN_TEXT });

/** The app at `path` for a deactivated account, the account server deciding `GET /users/me`. */
async function openDeactivated(path: string, extra: RequestHandler[] = []) {
  const user = userEvent.setup();
  const account = accountServer("deactivated");
  const feed = feedServer(feedPage([THEIRS, MINE], null));
  const app = renderAppAt(path, "deactivated", [
    feed.handler,
    gamesAre(),
    ...account.handlers,
    ...extra,
  ]);
  const banner = await deactivatedShown();
  return { user, app, account, feed, banner };
}

function main(): HTMLElement {
  return screen.getByRole("main");
}

describe("the deactivated banner (criterion 10)", () => {
  it.each(["/", "/search", "/stats/seasons", `/profile/${OWN_USER_ID}`])(
    "is on %s, named, reading Your account is deactivated",
    async (path) => {
      const { banner } = await openDeactivated(path);

      expect(banner).toHaveTextContent(/your account is deactivated/i);
      expect(
        within(banner).getByRole("button", { name: "Recover account" }),
      ).toBeInTheDocument();
      expect(
        within(banner).getByRole("button", { name: "Sign out" }),
      ).toBeInTheDocument();
    },
  );

  it("is a region, not a second header: the page keeps one banner landmark", async () => {
    const { banner } = await openDeactivated("/");

    expect(banner.tagName).not.toBe("HEADER");
    // A card's own `<header>` is no landmark in a browser, but testing-library
    // counts it: keep only the page-level ones, as `AppLayout.test.tsx` does.
    const pageBanners = screen
      .getAllByRole("banner")
      .filter(
        (element) =>
          element.parentElement?.closest(
            "main, article, aside, nav, section",
          ) == null,
      );
    expect(pageBanners).toHaveLength(1);
  });

  it("stays while a thread is open over the page", async () => {
    const thread = threadServer([threadView(THEIRS, [])]);
    await openDeactivated("/posts/101", [thread.handler]);
    await screen.findByRole("dialog", { name: "Thread" });

    expect(await deactivatedBanner()).toBeInTheDocument();
  });

  it("is not shown to an active member", async () => {
    const account = accountServer("active");
    renderAppAt("/", "member", [...account.handlers]);
    await screen.findByRole("link", { name: /^your profile$/i });

    expect(queryDeactivatedBanner()).toBeNull();
  });

  it("Sign out signs out: the banner goes and Sign in is offered", async () => {
    const { user, app, banner } = await openDeactivated("/");

    await user.click(within(banner).getByRole("button", { name: "Sign out" }));

    expect(
      (app.authService as FakeAuthService).callsTo("signOut"),
    ).toHaveLength(1);
    expect(
      await screen.findByRole("link", { name: /^sign in$/i }),
    ).toBeInTheDocument();
    expect(queryDeactivatedBanner()).toBeNull();
  });
});

describe("a deactivated account browses public pages as a guest (criterion 10)", () => {
  it("Like and Repost send no write", async () => {
    const like = likeStub();
    const repost = repostStub();
    const { user } = await openDeactivated("/", [
      ...like.handlers,
      ...repost.handlers,
    ]);
    const card = cardUnderneath(THEIR_TEXT);

    // Both found first: as for a guest, the first press may leave the page
    // (to sign-in), and then the second control is simply gone.
    const likeButton = within(card).queryByRole("button", { name: "Like" });
    const repostButton = within(card).queryByRole("button", { name: "Repost" });
    if (likeButton !== null) await user.click(likeButton);
    if (repostButton !== null && repostButton.isConnected) {
      await user.click(repostButton);
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(like.calls).toEqual([]);
    expect(repost.calls).toEqual([]);
  });

  it("the menu offers Copy link only: no Report on another's post", async () => {
    const report = reportStub();
    const { user } = await openDeactivated("/", [report.handler]);

    const menu = await openMenu(user, cardUnderneath(THEIR_TEXT));

    expect(itemNames(menu)).toEqual(["Copy link"]);
  });

  it("the menu offers no Delete, even on a post the account wrote", async () => {
    const deletion = deletePostStub();
    const { user } = await openDeactivated("/", [deletion.handler]);

    const menu = await openMenu(user, cardUnderneath(OWN_TEXT));

    expect(itemNames(menu)).toEqual(["Copy link"]);
  });

  it("the thread modal offers no reply box, even opened to reply", async () => {
    const thread = threadServer([threadView(THEIRS, [])]);
    await openDeactivated("/posts/101?reply=1", [thread.handler]);

    const dialog = await screen.findByRole("dialog", { name: "Thread" });
    await within(dialog).findByText(THEIR_TEXT);

    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(
      within(dialog).queryByRole("button", { name: /^reply$/i }),
    ).toBeNull();
  });

  it("following someone sends no write", async () => {
    const follow = followStub();
    const { user } = await openDeactivated("/profile/42", follow.handlers);
    await screen.findByRole("heading", { name: /courtside42/ });

    const button = screen.queryByRole("button", { name: /^follow$/i });
    if (button !== null) await user.click(button);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(follow.calls).toEqual([]);
  });
});

describe("a signed-in-only route shows the recovery screen (criterion 11)", () => {
  it.each([
    ["/compose", "Compose"],
    ["/notifications", "Notifications"],
  ])("%s shows recovery instead of its content", async (path, heading) => {
    await openDeactivated(path);

    expect(
      await within(main()).findByRole("heading", { name: /deactivated/i }),
    ).toBeInTheDocument();
    expect(
      within(main()).queryByRole("heading", { level: 1, name: heading }),
    ).toBeNull();
    const text = main().textContent ?? "";
    expect(text, "what recovery restores").toMatch(/restore/i);
    expect(text, "and what it does not").toMatch(/deleted/i);
    expect(
      within(main()).getAllByRole("button", { name: "Recover account" }).length,
    ).toBeGreaterThan(0);
    expect(
      within(main()).getAllByRole("button", { name: "Sign out" }).length,
    ).toBeGreaterThan(0);
  });

  it("does not send the account to sign-in or to profile creation", async () => {
    const { app } = await openDeactivated("/compose");
    await within(main()).findByRole("heading", { name: /deactivated/i });

    expect(app.router.state.location.pathname).toBe("/compose");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("profile creation is never offered to a deactivated account", async () => {
    const { app } = await openDeactivated("/create-profile");

    await waitFor(() =>
      expect(
        screen.queryByText(/checking whether you have a profile/i),
      ).toBeNull(),
    );
    expect(screen.queryByRole("textbox", { name: /username/i })).toBeNull();
    expect(app.router.state.location.pathname).not.toBe("/sign-in");
  });
});

describe("recovering the account (criterion 12)", () => {
  it("sends POST /users/me/recover once, and the banner goes", async () => {
    const { user, account, banner } = await openDeactivated("/");

    await user.click(
      within(banner).getByRole("button", { name: "Recover account" }),
    );

    await waitFor(() => expect(account.recoveries).toHaveLength(1));
    await waitFor(() => expect(queryDeactivatedBanner()).toBeNull());
  });

  it("invalidates every cached query: the feed is read again", async () => {
    const { user, feed, banner } = await openDeactivated("/");
    const reads = feed.requests.length;

    await user.click(
      within(banner).getByRole("button", { name: "Recover account" }),
    );

    await waitFor(() => expect(queryDeactivatedBanner()).toBeNull());
    await waitFor(() => expect(feed.requests.length).toBeGreaterThan(reads));
  });

  it("the page then renders for an active member: Like sends its write", async () => {
    const like = likeStub();
    const { user, banner } = await openDeactivated("/", like.handlers);

    await user.click(
      within(banner).getByRole("button", { name: "Recover account" }),
    );
    await waitFor(() => expect(queryDeactivatedBanner()).toBeNull());
    await screen.findByRole("link", { name: /^your profile$/i });

    await user.click(
      within(cardUnderneath(THEIR_TEXT)).getByRole("button", { name: "Like" }),
    );

    await waitFor(() =>
      expect(like.calls).toEqual([{ method: "POST", postId: 101 }]),
    );
  });

  it("from the recovery screen, the route the viewer was on renders", async () => {
    const { user, app } = await openDeactivated("/compose");
    await within(main()).findByRole("heading", { name: /deactivated/i });

    await user.click(
      within(main()).getAllByRole("button", { name: "Recover account" })[0],
    );

    // FRONTEND-020: the composer is a dialog titled Compose (its title an h2).
    const dialog = await screen.findByRole("dialog", { name: "Compose" });
    expect(
      await within(dialog).findByRole("textbox", { name: /post/i }),
    ).toBeInTheDocument();
    expect(app.router.state.location.pathname).toBe("/compose");
    expect(queryDeactivatedBanner()).toBeNull();
  });

  it("a failure is an alert beside the button, and the account stays deactivated", async () => {
    const { user, account, banner } = await openDeactivated("/");
    account.failRecover();

    await user.click(
      within(banner).getByRole("button", { name: "Recover account" }),
    );

    expect(await within(banner).findByRole("alert")).toBeInTheDocument();
    expect(await deactivatedBanner()).toBe(banner);
    expect(account.recoveries).toHaveLength(1);
  });

  it("does not send a second recover while the first is in flight", async () => {
    const { user, account, banner } = await openDeactivated("/");
    const release = account.holdRecover();

    const button = within(banner).getByRole("button", {
      name: "Recover account",
    });
    await user.click(button);
    if (button.isConnected && !button.hasAttribute("disabled")) {
      await user.click(button);
    }
    release();

    await waitFor(() => expect(queryDeactivatedBanner()).toBeNull());
    expect(account.recoveries).toHaveLength(1);
  });
});
