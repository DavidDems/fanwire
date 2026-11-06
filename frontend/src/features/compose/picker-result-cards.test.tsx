/**
 * FRONTEND-037: the compose stats picker's game choices are the same result
 * cards as Stats > Seasons > a team (`features/stats/season-results.test.tsx`):
 *
 * - the team level's games are one list, newest first as the API sends them,
 *   each item exactly one control: here a button (the picker has no
 *   addresses), whose accessible name is the matchup with the selected team
 *   first in short names ("Raptors vs Suns"), "Won" or "Lost", the score
 *   ("117–109") and the game type ("Regular season");
 * - no date and no city name in the list (the date was the old control);
 * - a click anywhere on the card opens the game's level, where the "Final
 *   score" radio and the player-line radios select exactly as before.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  BARNES_LINE_ID,
  COMPLETED_GAME,
  UNPLAYED_GAME,
  attachServer,
  confirmSelection,
  openPicker,
  pickerShown,
} from "../../test/attach";
import { renderWithAuth } from "../../test/auth";
import { createPost } from "../../test/compose";
import { server } from "../../test/server";
import type { components } from "../../api/schema";
import { ComposePage } from "./ComposePage";

type CreatePostRequest = components["schemas"]["CreatePostRequest"];

const EN_DASH = String.fromCodePoint(0x2013);

function renderComposer() {
  const bodies: CreatePostRequest[] = [];
  const { handlers, stubs } = attachServer();
  server.use(
    ...handlers,
    createPost({ onRequest: (body) => bodies.push(body) }),
  );
  renderWithAuth(<ComposePage />, { route: "/compose" });
  return { user: userEvent.setup(), stubs, bodies };
}

/** Open Toronto's level in the picker and return its result cards. */
async function openRaptors(
  user: ReturnType<typeof userEvent.setup>,
): Promise<{ dialog: HTMLElement; items: HTMLElement[] }> {
  await openPicker(user);
  const dialog = await pickerShown();
  await user.click(
    await within(dialog).findByRole("button", { name: /^Toronto Raptors$/ }),
  );
  await within(dialog).findByRole("heading", {
    level: 2,
    name: /Toronto Raptors, 2023-24/,
  });
  const list = await within(dialog).findByRole("list", {
    name: (_name, element) =>
      within(element as HTMLElement)
        .queryAllByRole("button")
        .some(
          (button) =>
            /\b(Won|Lost)\b/.test(button.textContent ?? "") ||
            /\b(Won|Lost)\b/.test(button.getAttribute("aria-label") ?? ""),
        ),
  });
  return { dialog, items: within(list).getAllByRole("listitem") };
}

describe("the picker's game choices are result cards", () => {
  it("lists the team's games newest first, one button each, named by matchup, result, score and game", async () => {
    const { user } = renderComposer();
    const { items } = await openRaptors(user);

    // The team season stub sends game 502 (newer) then 501.
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(within(item).queryAllByRole("link")).toEqual([]);
      expect(within(item).getAllByRole("button")).toHaveLength(1);
    }
    const completed = within(items[1]).getByRole("button");
    expect(completed).toHaveAccessibleName(
      expect.stringContaining("Raptors vs Suns"),
    );
    expect(completed).toHaveAccessibleName(/\bWon\b/);
    expect(completed).toHaveAccessibleName(
      expect.stringContaining(`117${EN_DASH}109`),
    );
    expect(completed).toHaveAccessibleName(
      expect.stringContaining("Regular season"),
    );
    expect(within(items[0]).getByRole("button")).toHaveAccessibleName(
      expect.stringContaining(`0${EN_DASH}0`),
    );
  });

  it("shows no date and no city name in the cards", async () => {
    const { user } = renderComposer();
    const { items } = await openRaptors(user);

    for (const item of items) {
      const button = within(item).getByRole("button");
      for (const forbidden of [
        /\b1[58] Jan|\bJan(uary)? 1[58]\b/,
        /\bToronto\b|\bPhoenix\b/,
      ]) {
        expect(item.textContent ?? "").not.toMatch(forbidden);
        expect(button).not.toHaveAccessibleName(forbidden);
      }
    }
    // The fixture's games, for the reader: 501 on 15 Jan, 502 on 18 Jan.
    expect([COMPLETED_GAME.id, UNPLAYED_GAME.id]).toEqual([501, 502]);
  });

  it("opens the game from its card, where a player line selects and attaches as before", async () => {
    const { user, stubs, bodies } = renderComposer();
    const { dialog, items } = await openRaptors(user);

    await user.click(within(items[1]).getByRole("button"));
    const final = await within(dialog).findByRole("radio", {
      name: /Final score/,
    });
    expect(stubs.detail.requests).toEqual([501]);
    expect(final).not.toBeChecked();

    const barnes = within(dialog).getByRole("radio", { name: /Barnes/ });
    await user.click(barnes);
    expect(barnes).toBeChecked();
    await confirmSelection(user);

    await user.type(screen.getByRole("textbox", { name: /post/i }), "Hi");
    await user.click(screen.getByRole("button", { name: /^post$/i }));
    await screen.findByRole("textbox", { name: /post/i });
    await expect
      .poll(() => bodies.map((body) => body.data_link))
      .toEqual([{ type: "player_game", ref_id: BARNES_LINE_ID }]);
  });
});
