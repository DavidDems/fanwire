/**
 * FRONTEND-020 — the game page's "Post about this" links (FRONTEND-017) open
 * the compose modal over the game page, with the same addresses.
 *
 * The page stays mounted underneath (the same heading node, no second read),
 * the dialog is titled "Compose" with the link's summary attached, opening it
 * reads only that summary's one request, and Close returns to the game page's
 * own entry with focus back on the link. That the links exist and where they
 * point is `post-about.test.tsx`'s.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { renderAppAt } from "../../test/app-route";
import {
  BARNES_LINE_ID,
  attachGameDetail,
  attachServer,
  summaryShown,
  textOf,
} from "../../test/attach";
import { recordRequests, type RequestRecorder } from "../../test/compose";
import {
  composeTarget,
  gameFinalAddress,
  linksTo,
  playerGameAddress,
  signedInShown,
  type ComposeTarget,
} from "../../test/post-about";

const GAME = attachGameDetail();

let recorder: RequestRecorder | null = null;

afterEach(() => {
  recorder?.stop();
  recorder = null;
});

async function openGame() {
  const { handlers } = attachServer();
  const app = renderAppAt(`/games/${GAME.id}`, "member", handlers);
  const heading = await screen.findByRole("heading", {
    level: 1,
    name: /Toronto Raptors/,
  });
  await signedInShown();
  return { app, heading, user: userEvent.setup() };
}

describe.each<[string, ComposeTarget, RegExp]>([
  ["the game result", gameFinalAddress(GAME.id), /\b117\b/],
  ["a box-score row", playerGameAddress(BARNES_LINE_ID, GAME.id), /Barnes/],
])("%s opens compose over the game page", (_name, address, summaryText) => {
  it("as a dialog titled Compose, the page underneath unchanged, reading only the summary", async () => {
    const { app, heading, user } = await openGame();
    const [link] = linksTo(screen.getByRole("main"), address);
    expect(link).toBeDefined();
    recorder = recordRequests();

    await user.click(link);

    const dialog = await screen.findByRole("dialog", { name: "Compose" });
    expect(
      composeTarget(
        `${app.router.state.location.pathname}${app.router.state.location.search}`,
      ),
    ).toEqual(address);
    expect(textOf(await summaryShown())).toMatch(summaryText);
    expect(dialog).toContainElement(
      within(dialog).getByRole("textbox", { name: /post/i }),
    );
    expect(
      screen.getByRole("heading", { level: 1, name: /Toronto Raptors/ }),
    ).toBe(heading);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recorder.paths()).toEqual([`/events/games/${GAME.id}`]);
  });

  it("Close returns to the game page's own entry, focus on the link", async () => {
    const { app, heading, user } = await openGame();
    const originKey = app.router.state.location.key;
    const [link] = linksTo(screen.getByRole("main"), address);

    await user.click(link);
    const dialog = await screen.findByRole("dialog", { name: "Compose" });
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Compose" })).toBeNull(),
    );
    expect(app.router.state.location.pathname).toBe(`/games/${GAME.id}`);
    expect(app.router.state.location.key).toBe(originKey);
    expect(
      screen.getByRole("heading", { level: 1, name: /Toronto Raptors/ }),
    ).toBe(heading);
    await waitFor(() => expect(link).toHaveFocus());
  });
});
