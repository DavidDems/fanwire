/**
 * FRONTEND-004 acceptance criterion 3, the grammar half.
 *
 * Two tokens, and they are deliberately asymmetric — see
 * `wiki/CodeContext/Modules/0x03-posts.md`, `EventMention` → Open decisions,
 * "Scope note":
 *
 * - `#GameId<digits>` is the *only* token `app.posts.mentions.MentionParser`
 *   implements. Selecting a game has to insert exactly that, or the backend
 *   creates no `EventMention` row and the attachment silently does nothing.
 * - `$TEAM` is deliberately **not** implemented there: a bare team abbreviation
 *   does not identify one `Game`, and `EventMention.game_id` is `NOT NULL`. An
 *   unresolvable token is dropped from mention creation while the post text is
 *   kept exactly as authored, so `$TOR` is carried in the text and produces no
 *   `EventMention`. That is correct, not a gap to work around here: this unit
 *   does not get to invent a resolution rule or a different `$` format.
 *
 * `activeMentionQuery` is the other half of the grammar — what the autocomplete
 * is currently completing. It lives here rather than in the dropdown so that the
 * mediator can replace the same run of text the dropdown was offering against,
 * and so neither has to guess what the other meant.
 */
import { describe, expect, it } from "vitest";

import { activeMentionQuery, gameMentionToken, teamMentionToken } from "./mentions";

describe("the token a selected suggestion inserts", () => {
  it("writes a game as the #GameId<digits> form the backend parses", () => {
    expect(gameMentionToken(123)).toBe("#GameId123");
  });

  it("writes a team as its abbreviation, upper-cased", () => {
    expect(teamMentionToken("TOR")).toBe("$TOR");
    expect(teamMentionToken("tor")).toBe("$TOR");
  });

  it("emits a game token the backend's grammar matches and a team token it does not", () => {
    // `app.posts.mentions` implements `#GameId<digits>` only. This is the
    // asymmetry, pinned so nobody later "fixes" it by inventing a `$` grammar.
    const BACKEND_GRAMMAR = /^#GameId\d+$/;

    expect(BACKEND_GRAMMAR.test(gameMentionToken(123))).toBe(true);
    expect(BACKEND_GRAMMAR.test(teamMentionToken("TOR"))).toBe(false);
  });
});

describe("the mention the composer is currently completing", () => {
  it("is nothing in an empty box", () => {
    expect(activeMentionQuery("")).toBeNull();
  });

  it("is nothing in ordinary prose", () => {
    expect(activeMentionQuery("Raptors win again")).toBeNull();
  });

  it("opens on a bare # with no query yet", () => {
    expect(activeMentionQuery("#")).toEqual({ trigger: "#", query: "" });
  });

  it("opens on a bare $ with no query yet", () => {
    expect(activeMentionQuery("Nice win $")).toEqual({
      trigger: "$",
      query: "",
    });
  });

  it("carries the digits typed after a #", () => {
    expect(activeMentionQuery("Raptors win #12")).toEqual({
      trigger: "#",
      query: "12",
    });
  });

  it("carries the letters typed after a $", () => {
    expect(activeMentionQuery("Raptors win $to")).toEqual({
      trigger: "$",
      query: "to",
    });
  });

  it("closes once the token is followed by a space", () => {
    // Otherwise the dropdown never goes away and the mediator would replace a
    // finished token with the next selection.
    expect(activeMentionQuery("Raptors win #GameId123 ")).toBeNull();
  });

  it("tracks only the last trigger, not an earlier finished one", () => {
    expect(activeMentionQuery("#GameId123 and $to")).toEqual({
      trigger: "$",
      query: "to",
    });
  });

  it("is not opened by an @ or by an email address", () => {
    // `@user` is explicitly unimplemented on the backend and has no table.
    expect(activeMentionQuery("ask @someone")).toBeNull();
    expect(activeMentionQuery("write to fan@example.test")).toBeNull();
  });
});
