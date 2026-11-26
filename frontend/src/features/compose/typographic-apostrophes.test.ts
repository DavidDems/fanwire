/**
 * FRONTEND-059: the compose notes use the typographic apostrophe
 * (`typography.md` section 2). Each string is pinned exactly, so a straight
 * apostrophe cannot pass.
 *
 * `describeBareLink` is pure; `checkAddressLink` reads game 501's box score
 * from `attachServer()`'s handlers, in which line 79999 is not.
 */
import { describe, expect, it } from "vitest";

import { attachServer } from "../../test/attach";
import { server } from "../../test/server";
import { checkAddressLink, describeBareLink } from "./attachmentReads";

describe("typographic apostrophes in the compose notes", () => {
  it("describeBareLink names a bare player's game with the typographic apostrophe", () => {
    expect(describeBareLink({ type: "player_game", ref_id: 80001 })).toBe(
      "Player’s game, line 80001",
    );
  });

  it("checkAddressLink's line-not-in-game note uses the typographic apostrophe", async () => {
    server.use(...attachServer().handlers);

    await expect(
      checkAddressLink({ type: "player_game", ref_id: 79999 }, 501),
    ).resolves.toEqual({
      ok: false,
      note: "The player’s line in this link is not in that game, so nothing is attached. You can still attach stats yourself.",
    });
  });
});
