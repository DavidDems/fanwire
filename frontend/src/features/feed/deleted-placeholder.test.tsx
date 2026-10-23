/**
 * FRONTEND-012 criterion 7 — "Post deleted" where a repost's original was
 * deleted by its owner (`POSTS-004`).
 *
 * The API says so with `reposted_post: null` and `reposted_post_deleted: true`
 * ([[0x03-posts]]). That is a different fact from `reposted_post: null` alone,
 * which is an original hidden because its author is deactivated, and which
 * keeps reading "This post is unavailable" (`repost-card.test.tsx`).
 *
 * - **A plain repost** of a deleted original: the reposter's line, unchanged,
 *   then a muted placeholder reading "Post deleted" in the original's place —
 *   no author, text, media, preview, time or link of the original.
 * - **A quote repost** of a deleted original: the quote itself (its author,
 *   text and controls) unchanged, with "Post deleted" where the original's box
 *   would be.
 *
 * A reply whose parent is gone needs nothing here: the thread modal already
 * keeps such a thread readable (`ThreadModal.test.tsx`, POSTS-004).
 */
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithAuth } from "../../test/auth";
import {
  testAuthor,
  testPlainRepost,
  testQuoteRepost,
  type PostView,
} from "../../test/feed";
import { PostNode } from "./PostNode";

const QUOTE_TEXT = "Told you so";

const PLAIN_OF_DELETED = testPlainRepost(null, {
  id: 405,
  author: testAuthor({ id: 22, username: "reposter22" }),
  original_post_id: 401,
  reposted_post_deleted: true,
});

const QUOTE_OF_DELETED = testQuoteRepost(null, QUOTE_TEXT, {
  id: 406,
  author: testAuthor({ id: 23, username: "quoter23" }),
  original_post_id: 401,
  reposted_post_deleted: true,
});

function renderNode(post: PostView) {
  renderWithAuth(<PostNode post={post} />);
  return screen.getAllByRole("article")[0];
}

function normalized(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The smallest element holding exactly "Post deleted". */
function placeholderIn(card: HTMLElement): HTMLElement {
  return within(card).getByText("Post deleted");
}

describe("a plain repost whose original was deleted", () => {
  it("says Post deleted, not This post is unavailable", () => {
    const card = renderNode(PLAIN_OF_DELETED);

    expect(placeholderIn(card)).toBeInTheDocument();
    expect(within(card).queryByText("This post is unavailable")).toBeNull();
  });

  it("keeps the reposter's own line unchanged", () => {
    const card = renderNode(PLAIN_OF_DELETED);

    const reposter = within(card).getByRole("link", { name: "reposter22" });
    expect(reposter).toHaveAttribute("href", "/profile/22");
    let line: HTMLElement | null = reposter;
    while (line !== null && !normalized(line).includes("reposted")) {
      line = line.parentElement;
    }
    expect(line).not.toBeNull();
    expect(normalized(line as HTMLElement)).toBe("reposter22 reposted");
  });

  it("shows nothing of the original: no time, no link to it, no media", () => {
    const card = renderNode(PLAIN_OF_DELETED);

    expect(card.querySelector("time")).toBeNull();
    expect(within(card).queryAllByRole("img")).toHaveLength(0);
    const links = within(card)
      .queryAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(links, "only the reposter's profile").toEqual(["/profile/22"]);
  });

  it("is a placeholder, not a link or a control", () => {
    const card = renderNode(PLAIN_OF_DELETED);

    const placeholder = placeholderIn(card);
    expect(placeholder.closest("a")).toBeNull();
    expect(placeholder.closest("button")).toBeNull();
  });
});

describe("a quote repost whose original was deleted", () => {
  it("shows the quote, its author and its controls, unchanged", () => {
    const card = renderNode(QUOTE_OF_DELETED);

    expect(within(card).getByText(QUOTE_TEXT)).toBeInTheDocument();
    expect(
      within(card).getByRole("link", { name: "quoter23" }),
    ).toHaveAttribute("href", "/profile/23");
    expect(
      within(card).getByRole("button", { name: "Like" }),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Repost" }),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("link", { name: "Reply" }),
    ).toBeInTheDocument();
  });

  it("says Post deleted where the original would be, not This post is unavailable", () => {
    const card = renderNode(QUOTE_OF_DELETED);

    expect(placeholderIn(card)).toBeInTheDocument();
    expect(within(card).queryByText("This post is unavailable")).toBeNull();
  });

  it("puts the placeholder after the quote's own text, with no link of the original's", () => {
    const card = renderNode(QUOTE_OF_DELETED);

    const text = within(card).getByText(QUOTE_TEXT);
    const placeholder = placeholderIn(card);
    expect(
      text.compareDocumentPosition(placeholder) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(placeholder.closest("a")).toBeNull();
    // The quote's own time is its only one.
    expect(card.querySelectorAll("time")).toHaveLength(1);
    expect(
      within(card)
        .queryAllByRole("link")
        .some((link) => link.getAttribute("href")?.startsWith("/posts/401")),
    ).toBe(false);
  });
});
