/**
 * UI-009 criteria 4, 7 and 8 — reposts render as the post they repost, and
 * every cached copy of a post agrees.
 *
 * **A plain repost is the original** (`is_repost`, no text, no media,
 * `reposted_post` set): a line "<reposter> reposted" with a repost icon, the
 * reposter's name linking to their profile, above the original's own card —
 * its author, time, text, media, controls and counts. Every action on it
 * targets `reposted_post.id`. With `reposted_post` null the card says "This
 * post is unavailable" rather than rendering empty.
 *
 * **A quote repost** shows its own author, text and controls (acting on its own
 * id), with the original inside as a compact card: author and text, no
 * controls, and a link to the original. Until `FRONTEND-010` adds `/posts/:id`
 * that link goes to the original author's profile.
 *
 * **Two cards of one post never disagree** (criterion 4): a feed page holding an
 * original and a plain repost of it shows the same post twice, once directly
 * and once inside the repost's `reposted_post`. Liking or reposting through
 * either card moves both, before the server answers.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { AuthService } from "../../auth/AuthService";
import {
  FakeAuthService,
  profileFound,
  renderWithAuth,
  testSession,
} from "../../test/auth";
import {
  TEST_PUBLIC_MEDIA_KEY,
  feedPage,
  feedStub,
  likeStub,
  repostStub,
  testAuthor,
  testMediaItem,
  testPlainRepost,
  testPostView,
  testQuoteRepost,
  type PostView,
} from "../../test/feed";
import { server } from "../../test/server";
import { FeedPage } from "./FeedPage";
import { PostNode } from "./PostNode";

const ORIGINAL_TEXT = "Original take on the trade";
const QUOTE_TEXT = "Hot take on this";

const ORIGINAL = testPostView({
  id: 401,
  text: ORIGINAL_TEXT,
  author: testAuthor({ id: 21, username: "original21" }),
  created_at: "2026-09-20T08:30:00Z",
  media: [testMediaItem()],
  like_count: 5,
  reply_count: 2,
  repost_count: 1,
});

const PLAIN = testPlainRepost(ORIGINAL, {
  id: 402,
  author: testAuthor({ id: 22, username: "reposter22" }),
});

const QUOTE = testQuoteRepost(
  testPostView({ ...ORIGINAL, media: [] }),
  QUOTE_TEXT,
  {
    id: 403,
    author: testAuthor({ id: 23, username: "quoter23" }),
    like_count: 3,
  },
);

function renderNode(post: PostView) {
  return renderWithAuth(<PostNode post={post} />);
}

function renderFeed(authService: AuthService) {
  return renderWithAuth(
    <Routes>
      <Route path="/" element={<FeedPage />} />
    </Routes>,
    { authService, route: "/" },
  );
}

function memberAuth(): AuthService {
  return new FakeAuthService({ session: testSession() });
}

/** The top-level cards: articles with no article around them. */
function topCards(): HTMLElement[] {
  return screen
    .getAllByRole("article")
    .filter((article) => article.parentElement?.closest("article") === null);
}

function normalized(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The top-level card for the plain repost: the one carrying the "reposted" line. */
function repostCard(): HTMLElement {
  const found = topCards().find((card) =>
    normalized(card).includes("reposted"),
  );
  if (found === undefined) throw new Error("no repost card");
  return found;
}

/** The original's own top-level card: carries its text and no "reposted" line. */
function originalCard(): HTMLElement {
  const found = topCards().find(
    (card) =>
      normalized(card).includes(ORIGINAL_TEXT) &&
      !normalized(card).includes("reposted"),
  );
  if (found === undefined) throw new Error("no original card");
  return found;
}

/** The smallest element around the reposter's link that reads "… reposted". */
function repostLine(): HTMLElement {
  let element: HTMLElement | null = screen.getByRole("link", {
    name: "reposter22",
  });
  while (element !== null && !normalized(element).includes("reposted")) {
    element = element.parentElement;
  }
  if (element === null)
    throw new Error("no reposted line around the reposter's link");
  return element;
}

describe("a plain repost renders as the post it reposts (criterion 7)", () => {
  it("opens with a line naming the reposter, linked to their profile, with a repost icon", () => {
    renderNode(PLAIN);

    expect(screen.getByRole("link", { name: "reposter22" })).toHaveAttribute(
      "href",
      "/profile/22",
    );
    const line = repostLine();
    expect(normalized(line)).toBe("reposter22 reposted");
    expect(line.querySelector("svg")).not.toBeNull();
    expect(line.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows the original's author, time, text and media below that line", () => {
    renderNode(PLAIN);

    const line = repostLine();
    const author = screen.getByRole("link", { name: "original21" });
    expect(author).toHaveAttribute("href", "/profile/21");
    const text = screen.getByText(ORIGINAL_TEXT);
    const time = document.querySelector(
      `time[datetime="${ORIGINAL.created_at}"]`,
    );
    expect(time).not.toBeNull();
    const image = screen.getByRole("img");
    expect(image.getAttribute("src")).toContain(TEST_PUBLIC_MEDIA_KEY);

    for (const later of [author, text, image]) {
      expect(
        Boolean(
          line.compareDocumentPosition(later) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        "the reposted line comes first",
      ).toBe(true);
    }
  });

  it("shows the original's controls and counts, once", () => {
    renderNode(PLAIN);

    expect(screen.getAllByRole("button", { name: "Like" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Repost" })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "Reply" })).toHaveLength(1);
    expect(screen.getByText("5 likes")).toBeInTheDocument();
    expect(screen.getByText("2 replies")).toBeInTheDocument();
    expect(screen.getByText("1 repost")).toBeInTheDocument();
  });

  it("replies to the original", () => {
    renderNode(PLAIN);

    expect(screen.getByRole("link", { name: "Reply" })).toHaveAttribute(
      "href",
      "/compose?reply_to=401",
    );
  });

  it("reflects the viewer's state on the original, not on the repost", () => {
    renderNode(
      testPlainRepost(
        { ...ORIGINAL, liked_by_viewer: true, reposted_by_viewer: true },
        { id: 402, author: testAuthor({ id: 22, username: "reposter22" }) },
      ),
    );

    expect(screen.getByRole("button", { name: "Like" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Repost" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("says This post is unavailable when the original is gone, rather than rendering empty", () => {
    renderNode(
      testPlainRepost(null, {
        id: 405,
        author: testAuthor({ id: 22, username: "reposter22" }),
      }),
    );

    const card = screen.getAllByRole("article")[0];
    expect(
      within(card).getByText("This post is unavailable"),
    ).toBeInTheDocument();
  });
});

describe("a plain repost's controls act on the original (criterion 7)", () => {
  it("likes reposted_post.id", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([PLAIN], null)]);
    const like = likeStub();
    server.use(feed.handler, ...like.handlers, profileFound());

    renderFeed(memberAuth());
    await screen.findByText(ORIGINAL_TEXT);

    await user.click(
      within(repostCard()).getByRole("button", { name: "Like" }),
    );

    await waitFor(() =>
      expect(like.calls).toEqual([{ method: "POST", postId: 401 }]),
    );
  });

  it("reposts reposted_post.id", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([PLAIN], null)]);
    const repost = repostStub();
    server.use(feed.handler, ...repost.handlers, profileFound());

    renderFeed(memberAuth());
    await screen.findByText(ORIGINAL_TEXT);

    await user.click(
      within(repostCard()).getByRole("button", { name: "Repost" }),
    );

    await waitFor(() =>
      expect(repost.calls).toEqual([{ method: "POST", postId: 401 }]),
    );
  });
});

describe("a quote repost shows its own post with the original inside (criterion 8)", () => {
  /** The compact card: the smallest box around the original's text that names its author. */
  function embedded(): HTMLElement {
    let element: HTMLElement | null = screen.getByText(ORIGINAL_TEXT);
    while (element !== null && !normalized(element).includes("original21")) {
      element = element.parentElement;
    }
    if (element === null)
      throw new Error("no embedded original naming its author");
    return element;
  }

  it("renders its own author and text", () => {
    renderNode(QUOTE);

    expect(screen.getByRole("link", { name: "quoter23" })).toHaveAttribute(
      "href",
      "/profile/23",
    );
    expect(screen.getByText(QUOTE_TEXT)).toBeInTheDocument();
  });

  it("has exactly one set of controls, and they are its own", () => {
    renderNode(QUOTE);

    expect(screen.getAllByRole("button", { name: "Like" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Repost" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Reply" })).toHaveAttribute(
      "href",
      "/compose?reply_to=403",
    );
    expect(screen.getByText("3 likes")).toBeInTheDocument();
    // The original's numbers are not on the quote's card.
    expect(screen.queryByText("5 likes")).toBeNull();
  });

  it("shows the original as a compact card with its author and text and no controls", () => {
    renderNode(QUOTE);

    const box = embedded();
    expect(normalized(box)).not.toContain(QUOTE_TEXT);
    expect(screen.getAllByRole("article")[0].contains(box)).toBe(true);
    expect(within(box).queryByRole("button", { name: "Like" })).toBeNull();
    expect(within(box).queryByRole("button", { name: "Repost" })).toBeNull();
    expect(within(box).queryByRole("link", { name: "Reply" })).toBeNull();
    expect(
      within(box).queryByRole("button", { name: /show replies/i }),
    ).toBeNull();
  });

  it("links to the original (its author's profile until FRONTEND-010 adds /posts/:id)", () => {
    renderNode(QUOTE);

    const hrefs = within(embedded())
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/profile/21");
  });

  it("likes its own id, not the original's", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([QUOTE], null)]);
    const like = likeStub();
    server.use(feed.handler, ...like.handlers, profileFound());

    renderFeed(memberAuth());
    await screen.findByText(QUOTE_TEXT);

    await user.click(screen.getByRole("button", { name: "Like" }));

    await waitFor(() =>
      expect(like.calls).toEqual([{ method: "POST", postId: 403 }]),
    );
  });
});

describe("every cached copy of a post agrees (criterion 4)", () => {
  it("liking through the repost card moves the original's own card too, at once", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([ORIGINAL, PLAIN], null)]);
    const like = likeStub();
    server.use(feed.handler, ...like.handlers, profileFound());

    renderFeed(memberAuth());
    await screen.findAllByText(ORIGINAL_TEXT);
    expect(within(originalCard()).getByText("5 likes")).toBeInTheDocument();
    expect(within(repostCard()).getByText("5 likes")).toBeInTheDocument();
    const liked = { ...ORIGINAL, like_count: 6, liked_by_viewer: true };
    feed.answerWith(
      feedPage([liked, { ...PLAIN, reposted_post: liked }], null),
    );
    const release = like.hold();

    await user.click(
      within(repostCard()).getByRole("button", { name: "Like" }),
    );

    await waitFor(() =>
      expect(
        within(originalCard()).getByRole("button", { name: "Like" }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    expect(within(originalCard()).getByText("6 likes")).toBeInTheDocument();
    expect(within(repostCard()).getByText("6 likes")).toBeInTheDocument();
    expect(
      within(repostCard()).getByRole("button", { name: "Like" }),
    ).toHaveAttribute("aria-pressed", "true");

    release();
    await waitFor(() =>
      expect(like.calls).toEqual([{ method: "POST", postId: 401 }]),
    );
  });

  it("liking the original's own card moves the copy inside the repost", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([ORIGINAL, PLAIN], null)]);
    const like = likeStub();
    server.use(feed.handler, ...like.handlers, profileFound());

    renderFeed(memberAuth());
    await screen.findAllByText(ORIGINAL_TEXT);
    const release = like.hold();

    await user.click(
      within(originalCard()).getByRole("button", { name: "Like" }),
    );

    expect(
      await within(repostCard()).findByText("6 likes"),
    ).toBeInTheDocument();
    release();
  });

  it("reposting through the repost card moves the original's own card too, at once", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([ORIGINAL, PLAIN], null)]);
    const repost = repostStub();
    server.use(feed.handler, ...repost.handlers, profileFound());

    renderFeed(memberAuth());
    await screen.findAllByText(ORIGINAL_TEXT);
    expect(within(originalCard()).getByText("1 repost")).toBeInTheDocument();
    const reposted = { ...ORIGINAL, repost_count: 2, reposted_by_viewer: true };
    feed.answerWith(
      feedPage([reposted, { ...PLAIN, reposted_post: reposted }], null),
    );
    const release = repost.hold();

    await user.click(
      within(repostCard()).getByRole("button", { name: "Repost" }),
    );

    await waitFor(() =>
      expect(
        within(originalCard()).getByRole("button", { name: "Repost" }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    expect(within(originalCard()).getByText("2 reposts")).toBeInTheDocument();
    expect(within(repostCard()).getByText("2 reposts")).toBeInTheDocument();

    release();
    await waitFor(() =>
      expect(repost.calls).toEqual([{ method: "POST", postId: 401 }]),
    );
  });

  it("a failed like through the repost card puts both cards back", async () => {
    const user = userEvent.setup();
    const feed = feedStub([feedPage([ORIGINAL, PLAIN], null)]);
    const like = likeStub();
    like.fail();
    server.use(feed.handler, ...like.handlers, profileFound());

    renderFeed(memberAuth());
    await screen.findAllByText(ORIGINAL_TEXT);

    await user.click(
      within(repostCard()).getByRole("button", { name: "Like" }),
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(originalCard()).getByText("5 likes")).toBeInTheDocument(),
    );
    expect(within(repostCard()).getByText("5 likes")).toBeInTheDocument();
  });
});
