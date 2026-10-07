/**
 * UI-005 — the feed's stream template, the `PostNode` card and thread, the
 * `LiveScoreTickerDecorator` score block and the like control
 * (`wiki/CodeContext/FrontendUI/layout.md` §3–§4, `components.md` §4 and the
 * `features/feed/*` rows of §5).
 *
 * What jsdom can honestly show (`verification.md` §2b, §2c): which shared
 * component each piece renders through, read off the class that component's
 * own module exports, and the attributes that carry state (`data-active`,
 * `aria-hidden`, `aria-expanded`). Every class asserted here belongs to a shared
 * module in `src/components/ui/`; that those rules exist on disk, and that the
 * feed's own module CSS is clean, is `feed-css.test.ts`.
 *
 * **The decorator adds a block and never restyles what it wraps.** So it is
 * rendered directly here with a bare `<p>` child, and the child must come out
 * exactly as it went in, as a direct child of the render container: the
 * decorator returns a fragment, and a styled wrapper around the children is the
 * thing the pattern forbids.
 *
 * Every `<header>` has the banner role, each post's included, so nothing here
 * asks for the banner page-wide. Nothing here branches on who the reader is
 * (`feed-isolation.test.ts`): every render is the same guest render.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import buttonStyles from "../../components/ui/Button.module.css";
import cardStyles from "../../components/ui/Card.module.css";
import emptyStyles from "../../components/ui/EmptyState.module.css";
import gameScoreStyles from "../../components/ui/GameScore.module.css";
import messageStyles from "../../components/ui/message.module.css";
import skeletonStyles from "../../components/ui/Skeleton.module.css";
import { renderWithAuth } from "../../test/auth";
import {
  feedPage,
  feedStub,
  testLiveScore,
  testPostView,
  threadStub,
  threadView,
  type FeedPageBody,
  type LiveScoreView,
  type PostView,
} from "../../test/feed";
import { renderWithProviders } from "../../test/render";
import { server } from "../../test/server";
import { FeedPage } from "./FeedPage";
import { LiveScoreTickerDecorator } from "./LiveScoreTickerDecorator";
import { PostNode } from "./PostNode";

const ROOT_TEXT = "Game thread, tip-off in ten";
const REPLY_TEXT = "That first quarter was ugly";

const ROOT = testPostView({ id: 301, text: ROOT_TEXT });
const REPLY = testPostView({
  id: 302,
  text: REPLY_TEXT,
  is_reply: true,
  parent_post_id: 301,
});

const LOADING = "Loading the feed…";
const LOAD_FAILED = "We could not load the feed just now. Please try again.";
const NOTHING_HERE = "There is nothing here yet.";
const NO_REPLIES = "No replies yet.";

const LIVE_CODES = ["Q1", "Q2", "Q3", "Q4", "OT", "BT", "HT"] as const;

/** The text a reader gets from `element`, ignoring any icon's empty SVG. */
function textOf(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Every element under `root` (itself excluded) carrying `className`. */
function withClass(root: Element, className: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("*")).filter((element) =>
    element.classList.contains(className),
  );
}

/** The innermost `<article>` holding `text`: an ancestor card holds its replies' text too. */
function articleFor(text: string): HTMLElement {
  const candidates = screen
    .getAllByRole("article")
    .filter((article) => article.textContent?.includes(text));
  if (candidates.length === 0)
    throw new Error(`no article containing ${JSON.stringify(text)}`);
  return candidates.reduce((deepest, candidate) =>
    deepest.contains(candidate) ? candidate : deepest,
  );
}

/** The status or alert paragraph that holds `text`, whatever wraps the text. */
function messageHolding(text: string, role: "status" | "alert"): HTMLElement {
  const holder = screen
    .getByText(text)
    .closest<HTMLElement>(`[role="${role}"]`);
  if (holder === null) throw new Error(`"${text}" is not inside a ${role}`);
  return holder;
}

function renderNode(post: PostView) {
  return renderWithAuth(<PostNode post={post} />);
}

function renderFeed() {
  return renderWithAuth(
    <Routes>
      <Route path="/" element={<FeedPage />} />
    </Routes>,
    { route: "/" },
  );
}

/** Opens `GET /feed` and holds it until the test ends, so the loading state stays put. */
let releaseFeed: (() => void) | null = null;

function holdFeed(): void {
  const gate = new Promise<void>((resolve) => {
    releaseFeed = resolve;
  });
  server.use(
    http.get("*/feed", async () => {
      await gate;
      return HttpResponse.json<FeedPageBody>(feedPage());
    }),
  );
}

afterEach(() => {
  releaseFeed?.();
  releaseFeed = null;
});

/** Renders the decorator on its own, with a bare paragraph as the decorated view. */
function renderTicker(scores: LiveScoreView[]) {
  const post = testPostView({
    mentioned_game_ids: scores.map((score) => score.game_id),
    live_scores: scores,
  });
  return renderWithProviders(
    <LiveScoreTickerDecorator post={post}>
      <p>Decorated view</p>
    </LiveScoreTickerDecorator>,
  );
}

function liveScoreRegion(): HTMLElement {
  return screen.getByRole("status", { name: "Live score" });
}

describe("PostNode as a card (criterion 1)", () => {
  it("renders a top-level post as an <article> Card", () => {
    renderNode(ROOT);

    const article = articleFor(ROOT_TEXT);
    expect(article.tagName).toBe("ARTICLE");
    expect(article).toHaveClass(cardStyles.card);
  });

  it("renders a nested reply as an <article> without the card class", async () => {
    const user = userEvent.setup();
    server.use(threadStub([threadView(ROOT, [REPLY])]).handler);
    renderNode(ROOT);

    const root = articleFor(ROOT_TEXT);
    await user.click(
      within(root).getByRole("button", { name: /show replies/i }),
    );
    await screen.findByText(REPLY_TEXT);

    const reply = articleFor(REPLY_TEXT);
    expect(reply).not.toBe(root);
    expect(root.contains(reply)).toBe(true);
    expect(reply.tagName).toBe("ARTICLE");
    expect(reply).not.toHaveClass(cardStyles.card);
    expect(root).toHaveClass(cardStyles.card);
  });
});

describe("LiveScoreTickerDecorator (criterion 2)", () => {
  it("renders its children first, unwrapped and unchanged", () => {
    const { container } = renderTicker([testLiveScore()]);

    const child = screen.getByText("Decorated view");
    expect(child.tagName).toBe("P");
    expect(child.parentElement).toBe(container);
    expect(container.firstElementChild).toBe(child);
    expect(child.outerHTML).toBe("<p>Decorated view</p>");
  });

  it("follows the children with the Live score status region", () => {
    renderTicker([testLiveScore()]);

    const child = screen.getByText("Decorated view");
    const region = liveScoreRegion();
    expect(region.contains(child)).toBe(false);
    expect(
      child.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders one GameScore per live_scores entry, inside the region", () => {
    renderTicker([
      testLiveScore({
        game_id: 1,
        home_score: 101,
        away_score: 99,
        status: "Q3",
      }),
      testLiveScore({
        game_id: 2,
        home_score: 88,
        away_score: 90,
        status: "FT",
      }),
      testLiveScore({
        game_id: 3,
        home_score: 12,
        away_score: 10,
        status: "Q1",
      }),
    ]);

    expect(withClass(liveScoreRegion(), gameScoreStyles.score)).toHaveLength(3);
  });

  it.each(LIVE_CODES)("shows a Live badge for status %s", (status) => {
    renderTicker([testLiveScore({ status })]);

    const region = liveScoreRegion();
    expect(within(region).getByText("Live")).toBeInTheDocument();
    expect(within(region).getByText(status)).toBeInTheDocument();
  });

  it("shows an unknown status as given, with no Live badge", () => {
    renderTicker([testLiveScore({ status: "ZZ" })]);

    const region = liveScoreRegion();
    expect(withClass(region, gameScoreStyles.score)).toHaveLength(1);
    expect(within(region).getByText("ZZ")).toBeInTheDocument();
    expect(within(region).queryByText("Live")).toBeNull();
  });
});

describe("the feed's loading, failed and empty states (criterion 3)", () => {
  it("shows a neutral StatusLine and three aria-hidden post skeletons while loading", async () => {
    holdFeed();
    const { container } = renderFeed();

    await screen.findByText(LOADING);
    const status = messageHolding(LOADING, "status");
    expect(status).toHaveClass(messageStyles.message, messageStyles.neutral);
    expect(textOf(status)).toBe(LOADING);

    const skeletons = withClass(container, skeletonStyles.post);
    expect(skeletons).toHaveLength(3);
    for (const skeleton of skeletons) {
      expect(skeleton).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("reports a failed load through InlineAlert, with the same words", async () => {
    server.use(
      http.get("*/feed", () =>
        HttpResponse.json({ detail: "Internal Server Error" }, { status: 500 }),
      ),
    );
    renderFeed();

    await screen.findByText(LOAD_FAILED);
    const alert = messageHolding(LOAD_FAILED, "alert");
    expect(alert).toHaveClass(messageStyles.message, messageStyles.danger);
    expect(textOf(alert)).toBe(LOAD_FAILED);
  });

  it("shows an empty feed through EmptyState, with the same words", async () => {
    server.use(feedStub([feedPage([], null)]).handler);
    const { container } = renderFeed();

    const message = await screen.findByText(NOTHING_HERE);
    expect(message).toHaveClass(emptyStyles.message);
    const empties = withClass(container, emptyStyles.empty);
    expect(empties).toHaveLength(1);
    expect(empties[0].contains(message)).toBe(true);
  });
});

describe("an expanded post with no replies (criterion 4)", () => {
  it("says No replies yet.", async () => {
    const user = userEvent.setup();
    server.use(threadStub([threadView(ROOT, [])]).handler);
    renderNode(ROOT);

    await user.click(screen.getByRole("button", { name: /show replies/i }));

    expect(
      await within(articleFor(ROOT_TEXT)).findByText(NO_REPLIES),
    ).toBeInTheDocument();
  });
});

describe("the like control (criterion 5)", () => {
  it("carries data-active when the post is liked", () => {
    renderNode(testPostView({ liked_by_viewer: true, like_count: 4 }));

    expect(screen.getByRole("button", { name: /^unlike$/i })).toHaveAttribute(
      "data-active",
    );
  });

  it("carries no data-active when the post is not liked", () => {
    renderNode(testPostView({ liked_by_viewer: false }));

    expect(screen.getByRole("button", { name: /^like$/i })).not.toHaveAttribute(
      "data-active",
    );
  });

  it("keeps N likes as one text node", () => {
    renderNode(testPostView({ like_count: 3 }));

    expect(screen.getByText("3 likes")).toBeInTheDocument();
  });
});

describe("Show replies (criterion 6)", () => {
  it("carries an aria-hidden chevron icon", () => {
    renderNode(ROOT);

    const button = screen.getByRole("button", { name: /show replies/i });
    const icon = button.querySelector("svg");
    expect(icon, "an <svg> inside Show replies").not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("toggles aria-expanded from false to true, as before", async () => {
    const user = userEvent.setup();
    server.use(threadStub([threadView(ROOT, [REPLY])]).handler);
    renderNode(ROOT);

    const button = screen.getByRole("button", { name: /show replies/i });
    expect(button).toHaveAttribute("aria-expanded", "false");

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
  });
});

describe("Load more (criterion 7)", () => {
  it("is a secondary Button with the same name", async () => {
    server.use(feedStub([feedPage([ROOT], 300), feedPage([], null)]).handler);
    renderFeed();

    const button = await screen.findByRole("button", { name: "Load more" });
    expect(button).toHaveClass(buttonStyles.button, buttonStyles.secondary);
  });

  it("is absent once the feed has no further page", async () => {
    server.use(feedStub([feedPage([ROOT], null)]).handler);
    renderFeed();

    await screen.findByText(ROOT_TEXT);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    });
  });
});
