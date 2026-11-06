/**
 * FRONTEND-034 — a reply's card shows the post it answers.
 *
 * What jsdom can pin (`verification.md` §2b and
 * `verification.md` §2c): the order the pieces sit
 * in, which post each link and control acts on, the parent box's contents and
 * its click, the Show this thread link and the state it carries, the deleted
 * and hidden parents, where the box applies and where it does not, and the
 * keyboard (DOM) order. The four-line clamp is read off the CSS rule that
 * matches the parent's text; the thread line, the forced-colors rule and the
 * module CSS's tokens are `feed-style.test.tsx`. Overflow at 320/360/1280 and
 * every browser row are not jsdom's to show.
 *
 * Assumed structure, stated so a reader can check it against the brief:
 *
 * - The parent box reuses the quote's compact original, so it carries the
 *   quote box's class (`PostNode.module.css` `.quoted`), and a missing parent
 *   is the quote's `MissingOriginal` (`.quoted.missing`).
 * - `PostNode` and `PreparedPostNode` take `showParent?: boolean`, defaulting
 *   to true; the thread modal's Replies list passes `false`.
 * - Show this thread links to `/posts/<parent_post_id>`, which is the parent's
 *   id whether the parent is present, deleted or hidden.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ComponentType } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import avatarStyles from "../../components/ui/Avatar.module.css";
import type { AuthService } from "../../auth/AuthService";
import { renderAppAt } from "../../test/app-route";
import {
  FakeAuthService,
  profileFound,
  renderWithAuth,
  teamsAre,
  testSession,
} from "../../test/auth";
import { allBlocks, parseCss, readSrcFile, selectors } from "../../test/css";
import {
  feedPage,
  feedStub,
  likeStub,
  testAuthor,
  testMediaItem,
  testPlainRepost,
  testPostView,
  testQuoteRepost,
  type PostView,
} from "../../test/feed";
import { historyStub } from "../../test/history";
import { declared } from "../../test/module-css";
import { playerCareerPreview, postWithPreview } from "../../test/previews";
import {
  accountsPage,
  accountsStub,
  gameFiltersAre,
  gamesStub,
  postsPage,
  postsStub,
} from "../../test/search";
import { server } from "../../test/server";
import { PostNode } from "./PostNode";
import styles from "./PostNode.module.css";

/** `PostNode` with the prop this unit adds (`showParent`, default true). */
type ReplyAwareProps = ComponentProps<typeof PostNode> & {
  showParent?: boolean;
};
const Card = PostNode as ComponentType<ReplyAwareProps>;

const PARENT_TEXT = "Raptors in six, write it down";
const REPLY_TEXT = "Bench depth says otherwise";
const SHOW_THREAD = "Show this thread";

const PARENT_AUTHOR = testAuthor({ id: 31, username: "parent31" });
const REPLY_AUTHOR = testAuthor({ id: 32, username: "replier32" });

const PARENT = testPostView({
  id: 501,
  text: PARENT_TEXT,
  author: PARENT_AUTHOR,
  created_at: "2026-09-28T11:00:00Z",
  reply_count: 1,
  like_count: 9,
  // The box shows no media: a parent with a picture still gets none in it.
  media: [testMediaItem({ id: 7001 })],
});

/** The parent with a data-link preview of its own (a career line). */
const PARENT_WITH_PREVIEW = postWithPreview(playerCareerPreview(), {
  id: 501,
  text: PARENT_TEXT,
  author: PARENT_AUTHOR,
  created_at: "2026-09-28T11:00:00Z",
});

function replyTo(
  parent: PostView | null,
  overrides: Partial<PostView> = {},
): PostView {
  return testPostView({
    id: 502,
    text: REPLY_TEXT,
    author: REPLY_AUTHOR,
    created_at: "2026-09-28T12:00:00Z",
    is_reply: true,
    parent_post_id: 501,
    replied_post: parent,
    replied_post_deleted: false,
    reply_count: 2,
    like_count: 0,
    ...overrides,
  });
}

const REPLY = replyTo(PARENT);

function ThreadProbe() {
  const { pathname, search, state } = useLocation();
  const background = (state as { background?: { pathname?: string } } | null)
    ?.background;
  return (
    <p>{`thread probe at ${pathname}${search} over ${background?.pathname ?? "nothing"}`}</p>
  );
}

function renderCard(
  post: PostView,
  options: { showParent?: boolean; authService?: AuthService } = {},
) {
  const props: ReplyAwareProps =
    options.showParent === undefined
      ? { post }
      : { post, showParent: options.showParent };
  return renderWithAuth(
    <Routes>
      <Route path="/" element={<Card {...props} />} />
      <Route path="/posts/:postId" element={<ThreadProbe />} />
      <Route path="/profile/:userId" element={<p>profile probe</p>} />
    </Routes>,
    { route: "/", authService: options.authService ?? new FakeAuthService() },
  );
}

/** The outermost card on the page. */
function card(): HTMLElement {
  const outer = screen
    .getAllByRole("article")
    .filter((article) => article.parentElement?.closest("article") === null);
  expect(outer, "one top-level card").toHaveLength(1);
  return outer[0];
}

function boxClass(): string {
  return `.${CSS.escape(styles.quoted)}`;
}

/** Every compact box (quote original, parent, or missing) inside `root`. */
function boxesIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(boxClass())];
}

/** The compact box holding `text`. */
function boxHolding(root: HTMLElement, text: string): HTMLElement {
  const box = within(root).getByText(text).closest<HTMLElement>(boxClass());
  if (box === null)
    throw new Error(`${JSON.stringify(text)} is in no compact box`);
  return box;
}

function precedes(first: Node, second: Node): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

function inOrder(label: string, nodes: Node[]): void {
  for (let index = 1; index < nodes.length; index += 1) {
    expect(
      precedes(nodes[index - 1], nodes[index]),
      `${label}: item ${index - 1} comes before item ${index}`,
    ).toBe(true);
  }
}

function showThread(root: HTMLElement): HTMLAnchorElement {
  return within(root).getByRole("link", { name: SHOW_THREAD });
}

/**
 * The card's tab stops in DOM order, each as "kind name -> href". jsdom has no
 * layout, so this is the order the keyboard takes with no positive tabindex,
 * which nothing on a card has.
 */
function tabStops(root: HTMLElement): string[] {
  const focusable = root.querySelectorAll<HTMLElement>(
    'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  return [...focusable]
    .filter(
      (element) =>
        !(element as HTMLButtonElement).disabled &&
        element.closest('[role="menu"], [hidden], [aria-hidden="true"]') ===
          null,
    )
    .map((element) => {
      const name = (
        element.getAttribute("aria-label") ??
        element.textContent ??
        ""
      )
        .replace(/\s+/g, " ")
        .trim();
      const href = element.getAttribute("href");
      return href === null
        ? `${element.tagName.toLowerCase()} ${name}`
        : `a ${name} -> ${href}`;
    });
}

const REPLY_TIME_HREF = "/posts/502";
const PARENT_TIME_HREF = "/posts/501";

describe("a reply's card, in order (criterion 2)", () => {
  it("renders the reply's header, text, preview and media, then the parent box, then the action row, then Show this thread", () => {
    const linked = postWithPreview(playerCareerPreview());
    const reply = replyTo(PARENT, {
      data_link: linked.data_link,
      data_link_preview: linked.data_link_preview,
      media: [testMediaItem({ id: 7002 })],
    });
    renderCard(reply);
    const article = card();

    const author = within(article).getByRole("link", { name: "replier32" });
    const text = within(article).getByText(REPLY_TEXT);
    const preview = within(article)
      .getAllByRole("link")
      .find((link) => link.getAttribute("href") === "/players/2544");
    if (preview === undefined) throw new Error("no reply preview link");
    const media = within(article).getByRole("img", {
      name: "Image posted by replier32",
    });
    const box = boxHolding(article, PARENT_TEXT);
    const like = within(article).getByRole("button", { name: "Like" });
    const more = within(article).getByRole("button", { name: "More options" });
    const show = showThread(article);

    inOrder("reply card", [
      author,
      text,
      preview,
      media,
      box,
      like,
      more,
      show,
    ]);
    // The reply's own content sits outside the box, at full size.
    for (const own of [author, text, preview, media]) {
      expect(box.contains(own)).toBe(false);
    }
    expect(box.contains(like)).toBe(false);
    expect(box.contains(show)).toBe(false);
  });

  it("is one card: the parent box is not an article of its own", () => {
    renderCard(REPLY);

    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(boxesIn(card())).toHaveLength(1);
  });

  it("gives the reply's own controls and counts, never the parent's", () => {
    renderCard(REPLY);
    const article = card();

    expect(
      within(article).getAllByRole("button", { name: "Like" }),
    ).toHaveLength(1);
    expect(
      within(article).getAllByRole("link", { name: "Reply" }),
    ).toHaveLength(1);
    expect(
      within(article).getByRole("link", { name: "Reply" }),
    ).toHaveAttribute("href", "/posts/502?reply=1");
    expect(within(article).getByText("2 replies")).toHaveAttribute(
      "href",
      "/posts/502",
    );
    expect(within(article).queryByText("9 likes")).toBeNull();
  });

  it("likes the reply, not the parent", async () => {
    const user = userEvent.setup();
    const like = likeStub();
    server.use(...like.handlers, profileFound());
    renderCard(REPLY, {
      authService: new FakeAuthService({ session: testSession() }),
    });

    await user.click(within(card()).getByRole("button", { name: "Like" }));

    await waitFor(() =>
      expect(like.calls).toEqual([{ method: "POST", postId: 502 }]),
    );
  });
});

describe("the parent box (criterion 3)", () => {
  it("shows a small avatar, the parent author's profile link and the time as a link to the parent's thread", () => {
    renderCard(REPLY);
    const box = boxHolding(card(), PARENT_TEXT);

    const avatar = [...box.querySelectorAll<HTMLElement>("*")].find((element) =>
      element.classList.contains(avatarStyles.avatar),
    );
    expect(avatar, "an avatar in the box").toBeDefined();
    expect(avatar).toHaveClass(avatarStyles.sm);
    expect(avatar).toHaveAttribute("aria-hidden", "true");

    expect(within(box).getByRole("link", { name: "parent31" })).toHaveAttribute(
      "href",
      "/profile/31",
    );
    const time = box.querySelector("time");
    expect(time).not.toBeNull();
    expect(time?.closest("a")).toHaveAttribute("href", PARENT_TIME_HREF);
  });

  it("has no controls, no media and no menu", () => {
    renderCard(REPLY);
    const box = boxHolding(card(), PARENT_TEXT);

    expect(within(box).queryAllByRole("button")).toHaveLength(0);
    expect(within(box).queryByRole("img")).toBeNull();
    expect(box.querySelector("img")).toBeNull();
    expect(within(box).queryByText("9 likes")).toBeNull();
    expect(within(box).queryByRole("link", { name: SHOW_THREAD })).toBeNull();
    // Its only links: the author and the time.
    expect(
      within(box)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/profile/31", PARENT_TIME_HREF]);
  });

  it("shows the parent's link preview, its link being the box's third", () => {
    renderCard(replyTo(PARENT_WITH_PREVIEW));
    const box = boxHolding(card(), PARENT_TEXT);

    expect(
      within(box)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/profile/31", PARENT_TIME_HREF, "/players/2544"]);
  });

  it("clamps the parent's text to four lines, by a rule of PostNode.module.css", () => {
    renderCard(REPLY);
    const text = within(boxHolding(card(), PARENT_TEXT)).getByText(PARENT_TEXT);

    expect(clampOf(text)).toBe("4");
  });

  it("opens the parent's thread, not the reply's, from a click on the box's surface", async () => {
    const user = userEvent.setup();
    renderCard(REPLY);

    await user.click(
      within(boxHolding(card(), PARENT_TEXT)).getByText(PARENT_TEXT),
    );

    expect(
      await screen.findByText("thread probe at /posts/501 over /"),
    ).toBeInTheDocument();
  });

  it("still opens the reply's own thread from a click on the reply's text", async () => {
    const user = userEvent.setup();
    renderCard(REPLY);

    await user.click(within(card()).getByText(REPLY_TEXT));

    expect(
      await screen.findByText("thread probe at /posts/502 over /"),
    ).toBeInTheDocument();
  });
});

describe("Show this thread (criterion 4)", () => {
  it("is a link with exactly that name to /posts/<parent id>", () => {
    renderCard(REPLY);

    const links = within(card()).getAllByRole("link", { name: SHOW_THREAD });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/posts/501");
    expect(links[0]).not.toHaveAttribute("tabindex");
  });

  it("carries the modal flow's state: the thread opens over the page", async () => {
    const user = userEvent.setup();
    renderCard(REPLY);

    await user.click(showThread(card()));

    expect(
      await screen.findByText("thread probe at /posts/501 over /"),
    ).toBeInTheDocument();
  });

  it("is the card's last tab stop, after More options", () => {
    renderCard(REPLY);
    const stops = tabStops(card());

    expect(stops[stops.length - 1]).toBe(`a ${SHOW_THREAD} -> /posts/501`);
    expect(stops[stops.length - 2]).toBe("button More options");
  });

  it("is absent from a post that is not a reply", () => {
    renderCard(PARENT);

    expect(
      within(card()).queryByRole("link", { name: SHOW_THREAD }),
    ).toBeNull();
    expect(boxesIn(card())).toHaveLength(0);
  });
});

describe("a parent that cannot be shown (criterion 5)", () => {
  it("shows the muted Post deleted box for a deleted parent, and still offers Show this thread", () => {
    renderCard(replyTo(null, { replied_post_deleted: true }));
    const article = card();

    const box = boxHolding(article, "Post deleted");
    expect(box).toHaveClass(styles.missing);
    expect(within(box).queryAllByRole("link")).toHaveLength(0);
    expect(within(article).queryByText("This post is unavailable")).toBeNull();
    expect(showThread(article)).toHaveAttribute("href", "/posts/501");
    inOrder("deleted parent", [
      within(article).getByText(REPLY_TEXT),
      box,
      within(article).getByRole("button", { name: "Like" }),
      showThread(article),
    ]);
  });

  it("shows This post is unavailable for a hidden parent, and still offers Show this thread", () => {
    renderCard(replyTo(null, { replied_post_deleted: false }));
    const article = card();

    const box = boxHolding(article, "This post is unavailable");
    expect(box).toHaveClass(styles.missing);
    expect(within(box).queryAllByRole("link")).toHaveLength(0);
    expect(within(article).queryByText("Post deleted")).toBeNull();
    expect(showThread(article)).toHaveAttribute("href", "/posts/501");
  });
});

describe("where the box does not apply: the thread's Replies list (criterion 6)", () => {
  it("shows the box by default", () => {
    renderCard(REPLY);

    expect(boxesIn(card())).toHaveLength(1);
  });

  it("shows no box and no Show this thread with showParent false", () => {
    renderCard(REPLY, { showParent: false });
    const article = card();

    expect(within(article).queryByText(PARENT_TEXT)).toBeNull();
    expect(boxesIn(article)).toHaveLength(0);
    expect(
      within(article).queryByRole("link", { name: SHOW_THREAD }),
    ).toBeNull();
    // Still the reply's own card, controls and all.
    expect(within(article).getByText(REPLY_TEXT)).toBeInTheDocument();
    expect(
      within(article).getByRole("button", { name: "Like" }),
    ).toBeInTheDocument();
  });

  it("shows no Post deleted box either with showParent false", () => {
    renderCard(replyTo(null, { replied_post_deleted: true }), {
      showParent: false,
    });

    expect(within(card()).queryByText("Post deleted")).toBeNull();
    expect(
      within(card()).queryByRole("link", { name: SHOW_THREAD }),
    ).toBeNull();
  });
});

describe("reposts of a reply (criterion 7)", () => {
  it("shows a plain repost of a reply as the reposted line, then the reply's card with its parent box", () => {
    renderCard(
      testPlainRepost(REPLY, {
        id: 9001,
        author: testAuthor({ id: 22, username: "reposter22" }),
      }),
    );
    const article = card();

    const line = within(article).getByText(/reposted/);
    const text = within(article).getByText(REPLY_TEXT);
    const box = boxHolding(article, PARENT_TEXT);
    const like = within(article).getByRole("button", { name: "Like" });
    const show = showThread(article);
    inOrder("plain repost of a reply", [line, text, box, like, show]);
    expect(show).toHaveAttribute("href", "/posts/501");
    expect(boxesIn(article)).toHaveLength(1);
  });

  it("shows a quote of a reply with its original box only: no parent box, no Show this thread", () => {
    renderCard(testQuoteRepost(REPLY, "Quoting this one"));
    const article = card();

    expect(boxesIn(article)).toHaveLength(1);
    expect(boxHolding(article, REPLY_TEXT)).toBe(boxesIn(article)[0]);
    expect(within(article).queryByText(PARENT_TEXT)).toBeNull();
    expect(
      within(article).queryByRole("link", { name: SHOW_THREAD }),
    ).toBeNull();
  });

  it("keeps a quote's original clamped to three lines, as today", () => {
    renderCard(testQuoteRepost(PARENT, "Quoting this one"));
    const text = within(boxHolding(card(), PARENT_TEXT)).getByText(PARENT_TEXT);

    expect(clampOf(text)).toBe("3");
  });
});

describe("keyboard order inside a reply card (criterion 9)", () => {
  it("goes author, time, parent's author, parent's time, parent's preview, Like, Reply and its count, Repost, More options, Show this thread", () => {
    renderCard(replyTo(PARENT_WITH_PREVIEW));
    const stops = tabStops(card());
    // A time link: its name is the card's date format, "28 Sep 2026, 12:00".
    const time = (href: string) =>
      expect.stringMatching(
        new RegExp(String.raw`^a \d{1,2} \w{3} \d{4}, \d{2}:\d{2} -> ${href}$`),
      );

    expect(stops).toEqual([
      "a replier32 -> /profile/32",
      time(REPLY_TIME_HREF),
      "a parent31 -> /profile/31",
      time(PARENT_TIME_HREF),
      expect.stringMatching(/ -> \/players\/2544$/),
      "button Like",
      "a Reply -> /posts/502?reply=1",
      "a 2 replies -> /posts/502",
      "button Repost",
      "button More options",
      `a ${SHOW_THREAD} -> /posts/501`,
    ]);
  });
});

describe("where the box applies (criterion 6)", () => {
  it("in the feed", async () => {
    renderAppAt("/", "member", [feedStub([feedPage([REPLY], null)]).handler]);

    const text = await screen.findByText(REPLY_TEXT);
    const article = text.closest("article") as HTMLElement;
    expect(within(article).getByText(PARENT_TEXT)).toBeInTheDocument();
    expect(showThread(article)).toHaveAttribute("href", "/posts/501");
  });

  it("in search results", async () => {
    renderAppAt("/search?q=raptors", "member", [
      accountsStub({ 0: accountsPage([], null) }).handler,
      postsStub({ 0: postsPage([REPLY], null) }).handler,
      gamesStub().handler,
      gameFiltersAre(),
      teamsAre(),
    ]);

    const text = await screen.findByText(REPLY_TEXT);
    const article = text.closest("article") as HTMLElement;
    expect(within(article).getByText(PARENT_TEXT)).toBeInTheDocument();
    expect(showThread(article)).toHaveAttribute("href", "/posts/501");
  });

  it("in History's replies", async () => {
    renderAppAt("/history?tab=replies", "member", [
      historyStub({ replies: [{ items: [REPLY], next_cursor: null }] }).handler,
    ]);

    const text = await screen.findByText(REPLY_TEXT);
    const article = text.closest("article") as HTMLElement;
    expect(within(article).getByText(PARENT_TEXT)).toBeInTheDocument();
    expect(showThread(article)).toHaveAttribute("href", "/posts/501");
  });
});

/**
 * The `-webkit-line-clamp` of the last rule in `PostNode.module.css` whose
 * selector matches `element` (class names mapped through the CSS module), or
 * `undefined` when no rule clamps it. jsdom computes no CSS, so the rule is
 * matched by hand; `line-clamp` must agree with it where both are set.
 */
function clampOf(element: Element): string | undefined {
  const blocks = allBlocks(
    parseCss(readSrcFile("features/feed/PostNode.module.css")),
  );
  let found: string | undefined;
  for (const block of blocks) {
    const clamp = declared(block, "-webkit-line-clamp");
    if (clamp === undefined) continue;
    const standard = declared(block, "line-clamp");
    if (standard !== undefined) expect(standard).toBe(clamp);
    if (
      selectors(block).some((selector) =>
        matchesModuleSelector(element, selector),
      )
    ) {
      found = clamp;
    }
  }
  return found;
}

/** `selector` from the module source, with each `.name` mapped to its built class. */
function matchesModuleSelector(element: Element, selector: string): boolean {
  if (/::?(before|after)\b/.test(selector)) return false;
  const mapped = selector.replace(
    /\.(-?[_a-zA-Z][\w-]*)/g,
    (_, name: string) =>
      `.${CSS.escape((styles as Record<string, string>)[name])}`,
  );
  try {
    return element.matches(mapped);
  } catch {
    return false;
  }
}
