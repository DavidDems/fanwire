/**
 * FRONTEND-008 acceptance criterion 10 — game mentions in a post's text.
 *
 * `PostNode` renders `post.text`; every `#GameId<n>` token whose `n` is in
 * the post's `mentioned_game_ids` (the ids the server resolved to a real game)
 * becomes a link to `/games/<n>` whose text is the token itself. A token whose
 * id is not in that list stays plain text — including one whose digits merely
 * *start* with a mentioned id (`#GameId5012` when 501 is mentioned). The
 * text is never parsed as HTML: markup in it reads literally, and the
 * rendered text is exactly the post's text, character for character.
 *
 * Rendered through `PostNode` itself, so the behaviour holds wherever a post
 * is shown (the feed, a thread, the search page's post results).
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithAuth } from "../../test/auth";
import { testPostView } from "../../test/feed";
import { PostNode } from "./PostNode";

function renderPost(text: string, mentionedGameIds: number[]) {
  const post = testPostView({ text, mentioned_game_ids: mentionedGameIds });
  renderWithAuth(<PostNode post={post} />);
  return screen.getByRole("article");
}

/** The element showing the post's text: the one whose text is exactly it. */
function textElement(article: HTMLElement, text: string): Element {
  const found = Array.from(article.querySelectorAll("*")).filter(
    (element) => element.textContent === text,
  );
  expect(found, `no element shows exactly ${JSON.stringify(text)}`).not.toEqual(
    [],
  );
  return found[found.length - 1];
}

function gameLinks(): HTMLElement[] {
  return screen
    .queryAllByRole("link")
    .filter((link) => /^#GameId\d+$/.test(link.textContent ?? ""));
}

describe("#GameId tokens in a post's text", () => {
  it("links a mentioned token to its game page, with the token as its text", () => {
    const text = "Watch #GameId501 tonight";
    const article = renderPost(text, [501]);

    const link = screen.getByRole("link", { name: "#GameId501" });
    expect(link).toHaveAttribute("href", "/games/501");
    expect(textElement(article, text).contains(link)).toBe(true);
  });

  it("leaves a token that is not in mentioned_game_ids as plain text", () => {
    const text = "Not a real one: #GameId999";
    const article = renderPost(text, [501]);

    expect(gameLinks()).toEqual([]);
    expect(textElement(article, text)).toBeDefined();
  });

  it("does not link a token whose digits only start with a mentioned id", () => {
    const text = "Typo #GameId5012 here";
    const article = renderPost(text, [501]);

    expect(gameLinks()).toEqual([]);
    expect(screen.queryByRole("link", { name: /#GameId501/ })).toBeNull();
    expect(textElement(article, text)).toBeDefined();
  });

  it("links each mentioned token, and only those, keeping the text exact", () => {
    const text =
      "#GameId501 then #GameId777, not #GameId999. Again #GameId501!";
    const article = renderPost(text, [501, 777]);

    const links = gameLinks();
    expect(links.map((link) => link.textContent)).toEqual([
      "#GameId501",
      "#GameId777",
      "#GameId501",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/games/501",
      "/games/777",
      "/games/501",
    ]);
    expect(textElement(article, text)).toBeDefined();
  });

  it("links nothing when the post mentions games its text does not name", () => {
    renderPost("No tokens here", [501]);

    expect(gameLinks()).toEqual([]);
  });

  it("never parses the text as HTML", () => {
    const text =
      '<b>bold</b> & <img src="x" alt="planted"> #GameId501 <a href="/evil">x</a>';
    const article = renderPost(text, [501]);

    expect(article.querySelector("b")).toBeNull();
    expect(article.querySelector("img[alt='planted']")).toBeNull();
    expect(article.querySelector("a[href='/evil']")).toBeNull();
    expect(textElement(article, text)).toBeDefined();
    expect(screen.getByRole("link", { name: "#GameId501" })).toHaveAttribute(
      "href",
      "/games/501",
    );
  });

  it("puts a mention link in the tab order", async () => {
    renderPost("Watch #GameId501 tonight", [501]);
    const link = screen.getByRole("link", { name: "#GameId501" });
    const user = userEvent.setup();

    let reached = false;
    for (let step = 0; step < 15 && !reached; step += 1) {
      await user.tab();
      reached = document.activeElement === link;
    }
    expect(reached).toBe(true);
  });
});
