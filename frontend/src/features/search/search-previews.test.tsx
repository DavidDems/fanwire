/**
 * FRONTEND-014 criteria 1 and 5, from search results: a result's card shows
 * its data-link preview, and the preview's link opens the detail in the modal
 * over the search page, which Close returns to with its query.
 *
 * Through the real route table, like `search-thread.test.tsx`.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderAppAt } from "../../test/app-route";
import { testAuthor } from "../../test/feed";
import { gameDetailStub } from "../../test/games";
import {
  PREVIEW_GAME_ID,
  gameFinalPreview,
  linedGameDetail,
  postWithPreview,
} from "../../test/previews";
import {
  accountsPage,
  accountsStub,
  postsPage,
  postsStub,
} from "../../test/search";
import { backgroundOf, cardUnderneath, openDialog } from "../../test/thread";

const POST_TEXT = "Raptors close it out";
const POST = postWithPreview(gameFinalPreview(), {
  id: 201,
  text: POST_TEXT,
  author: testAuthor({ id: 12, username: "courtside12" }),
});
const GAME_HREF = `/games/${PREVIEW_GAME_ID}`;

function gameLink(card: HTMLElement): HTMLAnchorElement {
  const links = [...card.querySelectorAll<HTMLAnchorElement>("a[href]")].filter(
    (link) => link.getAttribute("href") === GAME_HREF,
  );
  expect(links).toHaveLength(1);
  return links[0];
}

describe("a search result's data-link preview", () => {
  it("shows the game and opens it in the modal over the search page", async () => {
    const user = userEvent.setup();
    const app = renderAppAt("/search?q=raptors", "anonymous", [
      accountsStub({ 0: accountsPage([], null) }).handler,
      postsStub({ 0: postsPage([POST], null) }).handler,
      gameDetailStub([linedGameDetail()]).handler,
    ]);
    await screen.findByText(POST_TEXT);
    const card = cardUnderneath(POST_TEXT);
    const heading = screen.getByRole("heading", { level: 1, name: "Search" });
    expect(card.textContent ?? "").toMatch(/Phoenix Suns|\bPHX\b/);

    await user.click(gameLink(card));

    await waitFor(() =>
      expect(app.router.state.location.pathname).toBe(GAME_HREF),
    );
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("table", {
      name: /Toronto Raptors box score/,
    });
    expect(backgroundOf(app.router)).toMatchObject({
      pathname: "/search",
      search: "?q=raptors",
    });
    expect(screen.getByRole("heading", { level: 1, name: "Search" })).toBe(
      heading,
    );

    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(openDialog()).toBeNull());
    expect(app.router.state.location.pathname).toBe("/search");
    expect(app.router.state.location.search).toBe("?q=raptors");
    expect(cardUnderneath(POST_TEXT)).toBe(card);
  });
});
