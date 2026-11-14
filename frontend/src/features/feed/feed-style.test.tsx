/**
 * UI-005 — the feed's stream template, the `PostNode` card and thread and the
 * like control
 * (`wiki/CodeContext/FrontendUI/layout.md` §3 and `layout.md` §4, `components-sports.md` §4
 * and the `features/feed/*` rows of `components-map-posts.md` §5).
 *
 * What jsdom can honestly show (`verification.md` §2b, `verification.md` §2c): which shared
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
  allBlocks,
  isAtRule,
  parseCss,
  readSrcFile,
  selectors,
  type CssBlock,
} from "../../test/css";
import {
  feedPage,
  feedStub,
  testAuthor,
  testPostView,
  type FeedPageBody,
  type PostView,
} from "../../test/feed";
import { declared, moduleCssViolations } from "../../test/module-css";
import { server } from "../../test/server";
import { FeedPage } from "./FeedPage";
import { PostNode } from "./PostNode";
import postStyles from "./PostNode.module.css";

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
    const feed = feedStub([feedPage([], null)]);
    server.use(feed.handler);
    const { container } = renderFeed();

    const message = await screen.findByText(NOTHING_HERE);
    expect(message).toHaveClass(emptyStyles.message);
    const empties = withClass(container, emptyStyles.empty);
    expect(empties).toHaveLength(1);
    expect(empties[0].contains(message)).toBe(true);
    const artwork = empties[0].querySelector("svg[aria-hidden='true']");
    expect(artwork).not.toBeNull();
    expect(
      artwork?.querySelectorAll(
        "a, button, input, select, textarea, [tabindex]",
      ),
    ).toHaveLength(0);
    expect(feed.requests).toHaveLength(1);
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

/**
 * FRONTEND-034: a reply's card. The decorative thread line, a 2px
 * `--color-border` rule in the card's left gutter from under the reply's
 * avatar to the Show this thread row, is read off `PostNode.module.css`
 * (jsdom draws nothing): CSS only, never in the accessibility tree, and kept
 * in forced-colors mode, where backgrounds are forced to Canvas but borders
 * keep a system colour. The four-line clamp on the parent's text is pinned
 * against the rendered element in `reply-card.test.tsx`; here, that the rule
 * exists and agrees with `line-clamp`.
 */
describe("a reply card's styles (FRONTEND-034)", () => {
  const POST_CSS = "features/feed/PostNode.module.css";
  const PARENT_TEXT = "The parent's take";
  const REPLY_TEXT = "The reply's answer";
  const PARENT = testPostView({
    id: 501,
    text: PARENT_TEXT,
    author: testAuthor({ id: 31, username: "parent31" }),
  });
  const REPLY = testPostView({
    id: 502,
    text: REPLY_TEXT,
    is_reply: true,
    parent_post_id: 501,
    replied_post: PARENT,
  });

  function blocks(): CssBlock[] {
    return parseCss(readSrcFile(POST_CSS));
  }

  /** The selector without its pseudo-element, class names mapped to the build's. */
  function mapped(selector: string): string {
    return selector
      .replace(/::?(before|after)\b/g, "")
      .replace(
        /\.(-?[_a-zA-Z][\w-]*)/g,
        (_, name: string) =>
          `.${CSS.escape((postStyles as Record<string, string>)[name])}`,
      );
  }

  function isPseudo(selector: string): boolean {
    return /::?(before|after)\b/.test(selector);
  }

  const LINE_VALUE =
    /\b2px\b.*var\(--color-border\)|var\(--color-border\).*\b2px\b/;

  /** Draws the 2px --color-border line as a left (inline-start) border. */
  function bordered(block: CssBlock): boolean {
    return ["border-left", "border-inline-start"].some((property) => {
      const value = declared(block, property);
      return (
        value !== undefined && LINE_VALUE.test(value) && /\bsolid\b/.test(value)
      );
    });
  }

  /** Draws it as a 2px-wide filled box positioned at the left. */
  function filled(block: CssBlock): boolean {
    const width = declared(block, "width") ?? declared(block, "inline-size");
    const fill =
      declared(block, "background-color") ?? declared(block, "background");
    return (
      width === "2px" &&
      fill !== undefined &&
      /var\(--color-border\)/.test(fill) &&
      ["left", "inset-inline-start", "inset", "inset-inline"].some(
        (property) => declared(block, property) !== undefined,
      )
    );
  }

  /** The style rules outside every at-rule that draw the thread line. */
  function lineRules(): CssBlock[] {
    return allBlocks(blocks()).filter(
      (block) =>
        !isAtRule(block) &&
        !/^@/.test(block.prelude) &&
        (bordered(block) || filled(block)),
    );
  }

  /** Elements under `root` (itself included) a rule's selector matches. */
  function matches(root: HTMLElement, selector: string): HTMLElement[] {
    const query = mapped(selector);
    return [root, ...root.querySelectorAll<HTMLElement>("*")].filter(
      (element) => {
        try {
          return element.matches(query);
        } catch {
          return false;
        }
      },
    );
  }

  it("has no raw colour, px font size or bare outline removal in PostNode.module.css", () => {
    expect(moduleCssViolations(readSrcFile(POST_CSS))).toEqual([]);
  });

  it("draws a 2px --color-border thread line in the left gutter", () => {
    expect(
      lineRules().map((block) => block.prelude),
      "a rule drawing the line: border-left/inline-start 2px solid var(--color-border), or a 2px-wide positioned box filled with it",
    ).not.toHaveLength(0);
  });

  it("puts the line on a reply's card, and on no other card", () => {
    const rules = lineRules().flatMap(selectors);
    expect(rules).not.toHaveLength(0);

    const reply = renderNode(REPLY);
    const replyCard = articleFor(REPLY_TEXT);
    expect(
      rules.some((selector) => matches(replyCard, selector).length > 0),
      "a line rule matches something in the reply's card",
    ).toBe(true);
    reply.unmount();

    renderNode(PARENT);
    const plain = articleFor(PARENT_TEXT);
    for (const selector of rules) {
      expect(matches(plain, selector), `${selector} on a plain post`).toEqual(
        [],
      );
    }
  });

  it("keeps the line out of the accessibility tree: a pseudo-element, or an aria-hidden element", () => {
    renderNode(REPLY);
    const replyCard = articleFor(REPLY_TEXT);
    const rules = lineRules().flatMap(selectors);
    expect(rules).not.toHaveLength(0);

    for (const selector of rules) {
      if (isPseudo(selector)) continue;
      for (const element of matches(replyCard, selector)) {
        expect(
          element.closest('[aria-hidden="true"]'),
          `${selector} draws on an element a screen reader reads`,
        ).not.toBeNull();
        expect(element.textContent ?? "").toBe("");
      }
    }
  });

  it("keeps the line in forced-colors mode", () => {
    const rules = lineRules();
    expect(rules).not.toHaveLength(0);
    const forced = allBlocks(blocks()).filter(
      (block) =>
        /^@media\b/i.test(block.prelude) &&
        /forced-colors\s*:\s*active/i.test(block.prelude),
    );
    for (const block of rules) {
      // A border keeps a system colour under forced colours.
      if (bordered(block)) continue;
      // A background is forced to Canvas: the line needs a forced-colors rule
      // that gives it a system colour or opts it out.
      const kept = forced
        .flatMap((media) => allBlocks(media.children))
        .some(
          (rule) =>
            selectors(rule).some((selector) =>
              selectors(block).includes(selector),
            ) &&
            (declared(rule, "forced-color-adjust") === "none" ||
              /\b(canvastext|graytext|buttonborder|buttontext)\b/i.test(
                declared(rule, "background-color") ??
                  declared(rule, "background") ??
                  "",
              )),
        );
      expect(kept, `${block.prelude} vanishes in forced-colors mode`).toBe(
        true,
      );
    }
  });

  it("declares a four-line clamp, -webkit-line-clamp and line-clamp agreeing", () => {
    const fourLine = allBlocks(blocks()).filter(
      (block) => declared(block, "-webkit-line-clamp") === "4",
    );
    expect(fourLine, "a rule clamping to four lines").not.toHaveLength(0);
    for (const block of fourLine) {
      expect(declared(block, "line-clamp"), block.prelude).toBe("4");
    }
  });
});
