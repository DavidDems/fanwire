/**
 * FRONTEND-037: a team's short name, the scoreboard form every compact game
 * result uses (the Stats team cards, the picker's cards, Recent Games and the
 * game page's team tabs).
 *
 * The interface this file pins, in `features/games/format.ts`:
 *
 * - `teamShortName(name: string): string` — the team's name without its city:
 *   "Boston Celtics" → "Celtics", "Portland Trail Blazers" → "Trail Blazers"
 *   (the two-word nickname kept whole), "Philadelphia 76ers" → "76ers",
 *   "Los Angeles Lakers" → "Lakers" (the two-word city dropped whole). A
 *   one-word name is itself.
 */
import { describe, expect, it } from "vitest";

import { teamShortName } from "./format";

describe("teamShortName", () => {
  it.each([
    ["Boston Celtics", "Celtics"],
    ["Indiana Pacers", "Pacers"],
    ["Dallas Mavericks", "Mavericks"],
    ["Toronto Raptors", "Raptors"],
    ["Phoenix Suns", "Suns"],
    ["Portland Trail Blazers", "Trail Blazers"],
    ["Philadelphia 76ers", "76ers"],
    ["Los Angeles Lakers", "Lakers"],
  ])("%s → %s", (name, short) => {
    expect(teamShortName(name)).toBe(short);
  });

  it("keeps a one-word name as it is", () => {
    expect(teamShortName("Celtics")).toBe("Celtics");
  });
});
