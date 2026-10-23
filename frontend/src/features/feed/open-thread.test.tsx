/**
 * FRONTEND-010 criteria 1, 6, 10 and 11 — how a post card opens its thread.
 *
 * - **The timestamp is the keyboard and screen-reader path**: the card's
 *   `<time>` sits inside a link to `/posts/<id>` — for a plain repost, the
 *   original's id, since the card stands for the original.
 * - **A click anywhere else on the card is a mouse convenience.** It opens the
 *   thread, except when it lands on or inside a link or a button (they do their
 *   own thing) or when the reader is selecting text. It is not a second focus
 *   stop: the card has no `tabindex` and is never wrapped in a link.
 * - **Reply opens the thread to reply** (`/posts/<id>?reply=1`), and nothing on
 *   the card goes to `/compose` any more. The reply count beside it is a link
 *   to the thread too. The "Show replies" disclosure is gone.
 * - **A quote's embedded original links to `/posts/<original id>`**, replacing
 *   UI-009's stand-in link to the original author's profile.
 *
 * Every navigation that opens a thread carries `state.background` — the page
 * the card was on — which is what lets the route table keep that page rendered
 * under the modal (`routes/thread-route.test.tsx`). The `/posts/:postId` route
 * here is a probe that reports where it was sent and over what.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { AuthService } from "../../auth/AuthService";
import {
  FakeAuthService,
  profileFound,
  renderWithAuth,
  testSession,
} from "../../test/auth";
import {
  likeStub,
  testAuthor,
  testPlainRepost,
  testPostView,
  testQuoteRepost,
  type PostView,
} from "../../test/feed";
import { server } from "../../test/server";
import { timestampLink } from "../../test/thread";
import { PostNode } from "./PostNode";

const TEXT = "Raptors in six";

const POST = testPostView({
  id: 101,
  text: TEXT,
  author: testAuthor({ id: 11, username: "courtside11" }),
  reply_count: 2,
});

const ORIGINAL = testPostView({
  id: 401,
  text: "Original take on the trade",
  author: testAuthor({ id: 21, username: "original21" }),
  reply_count: 2,
});

function ThreadProbe() {
  const { pathname, search, state } = useLocation();
  const background = (state as { background?: { pathname?: string } } | null)
    ?.background;
  return (
    <p>{`thread probe at ${pathname}${search} over ${background?.pathname ?? "nothing"}`}</p>
  );
}

function ProfileProbe() {
  const { pathname } = useLocation();
  return <p>{`profile probe at ${pathname}`}</p>;
}

function renderCard(
  post: PostView,
  authService: AuthService = new FakeAuthService(),
) {
  return renderWithAuth(
    <Routes>
      <Route path="/" element={<PostNode post={post} />} />
      <Route path="/posts/:postId" element={<ThreadProbe />} />
      <Route path="/profile/:userId" element={<ProfileProbe />} />
    </Routes>,
    { authService, route: "/" },
  );
}

function card(): HTMLElement {
  return screen.getAllByRole("article")[0];
}

describe("the timestamp links to the thread", () => {
  it("puts a post's <time> inside a link to /posts/<id>", () => {
    renderCard(POST);

    expect(timestampLink(card())).toHaveAttribute("href", "/posts/101");
  });

  it("links a plain repost's timestamp to the original's thread", () => {
    renderCard(
      testPlainRepost(ORIGINAL, {
        id: 402,
        author: testAuthor({ id: 22, username: "reposter22" }),
      }),
    );

    expect(timestampLink(card())).toHaveAttribute("href", "/posts/401");
  });

  it("opens the thread over the page the card was on", async () => {
    const user = userEvent.setup();
    renderCard(POST);

    await user.click(timestampLink(card()));

    expect(
      await screen.findByText("thread probe at /posts/101 over /"),
    ).toBeInTheDocument();
  });
});

describe("a click elsewhere on the card opens the thread", () => {
  it("opens it from a click on the post's text", async () => {
    const user = userEvent.setup();
    renderCard(POST);

    await user.click(within(card()).getByText(TEXT));

    expect(
      await screen.findByText("thread probe at /posts/101 over /"),
    ).toBeInTheDocument();
  });

  it("opens the original's thread from a click on a plain repost's text", async () => {
    const user = userEvent.setup();
    renderCard(testPlainRepost(ORIGINAL, { id: 402 }));

    await user.click(within(card()).getByText("Original take on the trade"));

    expect(
      await screen.findByText("thread probe at /posts/401 over /"),
    ).toBeInTheDocument();
  });

  it("leaves a link to do its own thing: the author's name goes to the profile", async () => {
    const user = userEvent.setup();
    renderCard(POST);

    await user.click(within(card()).getByRole("link", { name: "courtside11" }));

    expect(
      await screen.findByText("profile probe at /profile/11"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/thread probe/)).toBeNull();
  });

  it("leaves a button to do its own thing: Like likes and does not navigate", async () => {
    const user = userEvent.setup();
    const like = likeStub();
    // Signed in, the card reads the account state (`FRONTEND-012`'s
    // `useAccount()`), which asks `GET /users/me`: answered, so the Like is an
    // active member's.
    server.use(...like.handlers, profileFound());
    renderCard(POST, new FakeAuthService({ session: testSession() }));

    await user.click(within(card()).getByRole("button", { name: "Like" }));

    await waitFor(() =>
      expect(like.calls).toEqual([{ method: "POST", postId: 101 }]),
    );
    expect(screen.queryByText(/thread probe/)).toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  it("does not open it while the reader is selecting text", async () => {
    renderCard(POST);
    const text = within(card()).getByText(TEXT);
    const selection = window.getSelection();
    if (selection === null) throw new Error("jsdom has no selection");
    const range = document.createRange();
    range.selectNodeContents(text);
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.click(text);

    // Give a navigation the chance to happen before asserting it did not.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/thread probe/)).toBeNull();
    expect(screen.getByText(TEXT)).toBeInTheDocument();
    selection.removeAllRanges();
  });

  it("is not a focus stop of its own: no tabindex, and no link around the card", () => {
    renderCard(POST);

    const article = card();
    expect(article).not.toHaveAttribute("tabindex");
    expect(article.closest("a")).toBeNull();
    expect(article.parentElement?.closest("a") ?? null).toBeNull();
  });
});

describe("the Show replies disclosure is gone (criterion 10)", () => {
  it("renders no Show replies control and no expanded state", () => {
    renderCard(POST);

    expect(screen.queryByRole("button", { name: /show replies/i })).toBeNull();
    // The card's "More options" menu button (FRONTEND-012) is the one
    // expanded state a card may carry: it opens a popup, not replies.
    expect(
      card().querySelector("[aria-expanded]:not([aria-haspopup])"),
    ).toBeNull();
  });
});

describe("reply opens the thread to reply (criterion 6)", () => {
  it("links Reply to /posts/<id>?reply=1", () => {
    renderCard(POST);

    expect(within(card()).getByRole("link", { name: "Reply" })).toHaveAttribute(
      "href",
      "/posts/101?reply=1",
    );
  });

  it("opens the thread over the page the card was on", async () => {
    const user = userEvent.setup();
    renderCard(POST);

    await user.click(within(card()).getByRole("link", { name: "Reply" }));

    expect(
      await screen.findByText("thread probe at /posts/101?reply=1 over /"),
    ).toBeInTheDocument();
  });

  it("replies to the original from a plain repost", () => {
    renderCard(testPlainRepost(ORIGINAL, { id: 402 }));

    expect(within(card()).getByRole("link", { name: "Reply" })).toHaveAttribute(
      "href",
      "/posts/401?reply=1",
    );
  });

  it("has no link to /compose anywhere on the card", () => {
    renderCard(testQuoteRepost(ORIGINAL, "Hot take on this", { id: 403 }));

    const hrefs = within(card())
      .getAllByRole("link")
      .map((link) => link.getAttribute("href") ?? "");
    expect(hrefs.filter((href) => href.startsWith("/compose"))).toEqual([]);
  });
});

describe("the reply count opens the thread too (criterion 10)", () => {
  it("is a link to /posts/<id>", () => {
    renderCard(POST);

    expect(
      within(card()).getByRole("link", { name: "2 replies" }),
    ).toHaveAttribute("href", "/posts/101");
  });

  it("opens the thread over the page the card was on", async () => {
    const user = userEvent.setup();
    renderCard(POST);

    await user.click(within(card()).getByRole("link", { name: "2 replies" }));

    expect(
      await screen.findByText("thread probe at /posts/101 over /"),
    ).toBeInTheDocument();
  });

  it("is the original's count, linked to the original, on a plain repost", () => {
    renderCard(testPlainRepost(ORIGINAL, { id: 402 }));

    expect(
      within(card()).getByRole("link", { name: "2 replies" }),
    ).toHaveAttribute("href", "/posts/401");
  });
});

describe("a quote repost's embedded original links to its thread (criterion 11)", () => {
  const QUOTE = testQuoteRepost(ORIGINAL, "Hot take on this", {
    id: 403,
    author: testAuthor({ id: 23, username: "quoter23" }),
  });

  /** The compact box: the smallest element around the original's text naming its author. */
  function embedded(): HTMLElement {
    let element: HTMLElement | null = screen.getByText(
      "Original take on the trade",
    );
    while (
      element !== null &&
      !(element.textContent ?? "").includes("original21")
    ) {
      element = element.parentElement;
    }
    if (element === null) throw new Error("no embedded original");
    return element;
  }

  it("contains a link to /posts/<original id>", () => {
    renderCard(QUOTE);

    const hrefs = within(embedded())
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/posts/401");
  });

  it("links the quote's own timestamp to the quote's own thread", () => {
    renderCard(QUOTE);

    // The quote's <time> is the first in the card; the original's is inside the box.
    const own = [...card().querySelectorAll("time")].find(
      (time) => !embedded().contains(time),
    );
    if (own === undefined) throw new Error("no timestamp of the quote's own");
    expect(own.closest("a")).toHaveAttribute("href", "/posts/403");
  });
});
