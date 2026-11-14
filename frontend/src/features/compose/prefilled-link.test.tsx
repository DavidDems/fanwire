/**
 * FRONTEND-013 criterion 8: the documented `/compose` address that opens the
 * composer with a link already attached — this unit's contract for
 * `FRONTEND-017`'s stats-page entry points.
 *
 * - `?link=game_final&ref=<game id>`
 * - `?link=player_game&ref=<line_id>&game=<game id>` (the game is only for
 *   finding the line to summarise: there is no read of a line by id)
 * - `?link=player_career&ref=<player id>&scope=regular|playoffs`
 *
 * **The parser is one exported function, `dataLinkIn(params)`, exported from
 * `ComposePage.tsx` beside `postIdIn`.** It validates at the boundary the way
 * `postIdIn` does: anything that is not exactly one of the three forms is
 * `null`, never a half-value. It answers `{ link, gameId }`, where `link` is
 * the `data_link` to send and `gameId` is the `game` parameter for a
 * `player_game` and `null` otherwise.
 *
 * The page half: a valid address opens with the summary shown, after the one
 * read that summary needs; an address that is wrong in any way — malformed
 * here, or refused by what the read returns — opens a plain composer with an
 * inline note, and the post that follows carries no `data_link`.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { components } from "../../api/schema";
import {
  BARNES_LINE_ID,
  GHOST_LINE_ID,
  attachServer,
  attachedSummary,
  noPlayoffsCareer,
  summaryShown,
  textOf,
  type AttachServerOptions,
} from "../../test/attach";
import { renderWithAuth } from "../../test/auth";
import { createPost } from "../../test/compose";
import { server } from "../../test/server";
import { ComposePage, dataLinkIn } from "./ComposePage";

type CreatePostRequest = components["schemas"]["CreatePostRequest"];

function parse(query: string) {
  return dataLinkIn(new URLSearchParams(query));
}

// ------------------------------------------------------------ the parser

describe("dataLinkIn, the address parser", () => {
  it("is exported from ComposePage.tsx as a function", () => {
    expect(typeof dataLinkIn).toBe("function");
  });

  it("reads a game result", () => {
    expect(parse("link=game_final&ref=501")).toEqual({
      link: { type: "game_final", ref_id: 501 },
      gameId: null,
    });
  });

  it("reads a player's game, keeping the game it is found in apart from the link", () => {
    expect(parse("link=player_game&ref=80001&game=501")).toEqual({
      link: { type: "player_game", ref_id: 80001 },
      gameId: 501,
    });
  });

  it.each(["regular", "playoffs"] as const)(
    "reads a career in the %s scope",
    (scope) => {
      expect(parse(`link=player_career&ref=2544&scope=${scope}`)).toEqual({
        link: { type: "player_career", ref_id: 2544, scope },
        gameId: null,
      });
    },
  );

  it("gives a link with no scope key unless it is a career", () => {
    const game = parse("link=game_final&ref=501");
    const line = parse("link=player_game&ref=80001&game=501");

    expect(Object.keys(game?.link ?? {}).sort()).toEqual(["ref_id", "type"]);
    expect(Object.keys(line?.link ?? {}).sort()).toEqual(["ref_id", "type"]);
  });

  it("ignores the other parameters the address may carry", () => {
    expect(parse("repost_of=7&link=game_final&ref=501")).toEqual({
      link: { type: "game_final", ref_id: 501 },
      gameId: null,
    });
  });

  it("is null when the address carries no link", () => {
    expect(parse("")).toBeNull();
    expect(parse("reply_to=42")).toBeNull();
  });

  it.each([
    ["no ref", "link=game_final"],
    ["an empty ref", "link=game_final&ref="],
    ["a ref that is not a number", "link=game_final&ref=abc"],
    ["a ref that is not an integer", "link=game_final&ref=1.5"],
    ["a zero ref", "link=game_final&ref=0"],
    ["a negative ref", "link=game_final&ref=-3"],
    ["a ref with no link", "ref=501"],
    ["an unknown link type", "link=team_season&ref=1"],
    ["an empty link type", "link=&ref=1"],
    ["a player's game with no game", "link=player_game&ref=80001"],
    [
      "a player's game whose game is not an id",
      "link=player_game&ref=80001&game=x",
    ],
    ["a player's game whose game is zero", "link=player_game&ref=80001&game=0"],
    ["a career with no scope", "link=player_career&ref=2544"],
    [
      "a career with an unknown scope",
      "link=player_career&ref=2544&scope=preseason",
    ],
    [
      "a career whose scope is not lower case",
      "link=player_career&ref=2544&scope=Regular",
    ],
    ["a game result with a scope", "link=game_final&ref=501&scope=regular"],
    ["a game result with a game", "link=game_final&ref=501&game=501"],
    [
      "a player's game with a scope",
      "link=player_game&ref=80001&game=501&scope=regular",
    ],
    [
      "a career with a game",
      "link=player_career&ref=2544&scope=regular&game=501",
    ],
  ])("is null for %s", (_name, query) => {
    expect(parse(query)).toBeNull();
  });
});

// -------------------------------------------------------------- the page

let bodies: CreatePostRequest[] = [];

afterEach(() => {
  bodies = [];
});

function renderAt(query: string, options: AttachServerOptions = {}) {
  const { handlers, stubs } = attachServer(options);
  server.use(
    ...handlers,
    createPost({ onRequest: (body) => bodies.push(body) }),
  );
  renderWithAuth(<ComposePage />, { route: `/compose${query}` });
  return { user: userEvent.setup(), stubs };
}

function textBox(): HTMLElement {
  return screen.getByRole("textbox", { name: /post/i });
}

async function postWithText(user: ReturnType<typeof userEvent.setup>) {
  await user.type(textBox(), "Look at this");
  await user.click(screen.getByRole("button", { name: /^post$/i }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  return bodies[0];
}

/** Every non-empty status or alert on the page. */
function notes(): string[] {
  return [...screen.queryAllByRole("status"), ...screen.queryAllByRole("alert")]
    .map(textOf)
    .filter((text) => text !== "");
}

describe("a valid pre-filled address opens with the link attached", () => {
  it("?link=game_final&ref=<game id> shows the game's summary", async () => {
    const { user, stubs } = renderAt("?link=game_final&ref=501");

    const summary = textOf(await summaryShown());
    expect(summary).toMatch(/\b117\b/);
    expect(summary).toMatch(/\b109\b/);
    expect(stubs.detail.requests).toContain(501);

    expect((await postWithText(user)).data_link).toEqual({
      type: "game_final",
      ref_id: 501,
    });
  });

  it("?link=player_game&ref=<line_id>&game=<game id> shows the player's line", async () => {
    const { user, stubs } = renderAt(
      `?link=player_game&ref=${BARNES_LINE_ID}&game=501`,
    );

    const summary = textOf(await summaryShown());
    expect(summary).toMatch(/Barnes/);
    expect(summary).toMatch(/\b22\b/);
    expect(stubs.detail.requests).toContain(501);

    expect((await postWithText(user)).data_link).toEqual({
      type: "player_game",
      ref_id: BARNES_LINE_ID,
    });
  });

  it("?link=player_career&ref=<player id>&scope=playoffs shows the career", async () => {
    const { user } = renderAt("?link=player_career&ref=2544&scope=playoffs");

    const summary = textOf(await summaryShown());
    expect(summary).toMatch(/LeBron James/);
    expect(summary).toMatch(/playoffs/i);
    expect(summary).toMatch(/\b287\b/);

    expect((await postWithText(user)).data_link).toEqual({
      type: "player_career",
      ref_id: 2544,
      scope: "playoffs",
    });
  });

  it("a plain /compose shows neither a summary nor a note", async () => {
    renderAt("");

    await screen.findByRole("textbox", { name: /post/i });
    expect(attachedSummary()).toBeNull();
    expect(notes()).toEqual([]);
  });
});

describe("an address that is wrong in any way opens with no attachment and a note", () => {
  it.each([
    ["a missing ref", "?link=game_final"],
    ["a malformed ref", "?link=game_final&ref=abc"],
    ["an unknown link type", "?link=team_season&ref=1"],
    ["a player's game with no game", `?link=player_game&ref=${BARNES_LINE_ID}`],
    ["a career with no scope", "?link=player_career&ref=2544"],
    [
      "a career with an unknown scope",
      "?link=player_career&ref=2544&scope=preseason",
    ],
    ["an unknown game", "?link=game_final&ref=999"],
    ["an incomplete (0–0) game", "?link=game_final&ref=502"],
    [
      "a line not in that game's box score",
      "?link=player_game&ref=79999&game=501",
    ],
    ["a DNP line", `?link=player_game&ref=${GHOST_LINE_ID}&game=501`],
    ["an unknown player", "?link=player_career&ref=999&scope=regular"],
  ])("%s", async (_name, query) => {
    const { user } = renderAt(query);

    await screen.findByRole("textbox", { name: /post/i });
    await waitFor(() => expect(notes().length).toBeGreaterThan(0));
    expect(attachedSummary()).toBeNull();

    const body = await postWithText(user);
    expect(Object.keys(body)).not.toContain("data_link");
  });

  it("a scope with no games", async () => {
    const { user } = renderAt("?link=player_career&ref=2544&scope=playoffs", {
      career: noPlayoffsCareer(),
    });

    await screen.findByRole("textbox", { name: /post/i });
    await waitFor(() => expect(notes().length).toBeGreaterThan(0));
    expect(attachedSummary()).toBeNull();

    const body = await postWithText(user);
    expect(Object.keys(body)).not.toContain("data_link");
  });
});
