/**
 * UI-005 — the feed's stream template, the `PostNode` card and thread and the
 * like control
 * (`wiki/CodeContext/FrontendUI/layout.md` §3–§4, `components.md` §4 and the
 * `features/feed/*` rows of §5).
 *
 * What jsdom can honestly show (`verification.md` §2b, §2c): which shared
 * component each piece renders through, read off the class that component's
 * own module exports, and the attributes that carry state (`aria-pressed`,
 * `aria-hidden`). The "Show replies" disclosure and the nested replies under a
 * card went with `FRONTEND-010`, whose thread modal replaced them. Every class asserted here belongs to a shared
 * module in `src/components/ui/`; that those rules exist on disk, and that the
 * feed's own module CSS is clean, is `feed-css.test.ts`.
 *
 * The live-score ticker (`LiveScoreTickerDecorator`) and its score block went
 * with the API-SPORTS live scores (EVENTS-003); a post card carries no score
 * block.
 *
 * Every `<header>` has the banner role, each post's included, so nothing here
 * asks for the banner page-wide. Nothing here branches on who the reader is
 * (`feed-isolation.test.ts`): every render is the same guest render.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import buttonStyles from "../../components/ui/Button.module.css";
import cardStyles from "../../components/ui/Card.module.css";
import emptyStyles from "../../components/ui/EmptyState.module.css";
import messageStyles from "../../components/ui/message.module.css";
import skeletonStyles from "../../components/ui/Skeleton.module.css";
import { renderWithAuth } from "../../test/auth";
import {
  feedPage,
  feedStub,
  testPostView,
  type FeedPageBody,
  type PostView,
} from "../../test/feed";
import { server } from "../../test/server";
import { FeedPage } from "./FeedPage";
import { PostNode } from "./PostNode";

const ROOT_TEXT = "Game thread, tip-off in ten";

const ROOT = testPostView({ id: 301, text: ROOT_TEXT });

const LOADING = "Loading the feed…";
const LOAD_FAILED = "We could not load the feed just now. Please try again.";
const NOTHING_HERE = "There is nothing here yet.";

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

describe("PostNode as a card (criterion 1)", () => {
  it("renders a top-level post as an <article> Card", () => {
    renderNode(ROOT);

    const article = articleFor(ROOT_TEXT);
    expect(article.tagName).toBe("ARTICLE");
    expect(article).toHaveClass(cardStyles.card);
  });
});

describe("no live-score block on a post card (EVENTS-003)", () => {
  it("renders a post that mentions games with no Live score region", () => {
    renderNode(
      testPostView({ id: 304, text: ROOT_TEXT, mentioned_game_ids: [1, 2] }),
    );

    const article = articleFor(ROOT_TEXT);
    expect(
      within(article).queryByRole("status", { name: "Live score" }),
    ).toBeNull();
    expect(within(article).queryAllByRole("status")).toHaveLength(0);
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

describe("the like control (criterion 5)", () => {
  // UI-009: the name is always "Like" and the state is aria-pressed (the
  // human's decision, 2026-10-16), replacing the data-active / "Unlike" pair.
  it("carries aria-pressed=true when the post is liked", () => {
    renderNode(testPostView({ liked_by_viewer: true, like_count: 4 }));

    expect(screen.getByRole("button", { name: "Like" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("carries aria-pressed=false when the post is not liked", () => {
    renderNode(testPostView({ liked_by_viewer: false }));

    expect(screen.getByRole("button", { name: "Like" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("keeps N likes as one text node", () => {
    renderNode(testPostView({ like_count: 3 }));

    expect(screen.getByText("3 likes")).toBeInTheDocument();
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
