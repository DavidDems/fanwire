/**
 * FRONTEND-013 criteria 1–5 and the keyboard row of 12: attaching one
 * sports-data link from `/compose`, as the user does it.
 *
 * Everything is driven through the rendered page and asserted on what reaches
 * the network: which `events/` reads the picker made (and with which query),
 * and the `data_link` in the `POST /posts` body. What is *not offered* is
 * asserted as the absence of a button, because a choice that is never shown
 * is the whole of "matches what the server accepts".
 *
 * The names a user reaches things by are the contract here, and the picker
 * drivers in `src/test/attach.ts` hold them in one place:
 * - "Attach stats" (a button with `aria-expanded`) opens the picker;
 * - its choices are buttons named "Game result", "Player's game" and
 *   "Player career";
 * - a game is narrowed with two native selects labelled Team and Season; a
 *   game, a box-score player, a search result and a career scope are each a
 *   button; the player search is an input labelled with "player";
 * - the attachment is summarised in a region named "Attached stats", with
 *   Remove inside it and Undo beside Post.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { components } from "../../api/schema";
import {
  BARNES_LINE_ID,
  CHOICES,
  COMPLETED_GAME_NAME,
  attachBarnesLine,
  attachGameResult,
  attachLebronCareer,
  attachServer,
  attachStatsButton,
  attachedSummary,
  findPlayerSearch,
  noPlayoffsCareer,
  openPicker,
  queryAttachStatsButton,
  summaryShown,
  textOf,
  type AttachServerOptions,
} from "../../test/attach";
import { renderWithAuth } from "../../test/auth";
import { createPost } from "../../test/compose";
import { server } from "../../test/server";
import { ComposePage } from "./ComposePage";
import { InlineComposer } from "./InlineComposer";

type CreatePostRequest = components["schemas"]["CreatePostRequest"];

let bodies: CreatePostRequest[] = [];

afterEach(() => {
  bodies = [];
});

function renderComposer(route = "/compose", options: AttachServerOptions = {}) {
  const { handlers, stubs } = attachServer(options);
  server.use(
    ...handlers,
    createPost({ onRequest: (body) => bodies.push(body) }),
  );
  renderWithAuth(<ComposePage />, { route });
  return { user: userEvent.setup(), stubs };
}

function textBox(): HTMLElement {
  return screen.getByRole("textbox", { name: /post/i });
}

function postButton(): HTMLElement {
  return screen.getByRole("button", { name: /^post$/i });
}

function undoButton(): HTMLElement {
  return screen.getByRole("button", { name: /^undo/i });
}

async function postWithText(
  user: ReturnType<typeof userEvent.setup>,
  text = "What a night",
): Promise<CreatePostRequest> {
  await user.type(textBox(), text);
  await user.click(postButton());
  await waitFor(() => expect(bodies).toHaveLength(1));
  return bodies[0];
}

// ----------------------------------------------------------- criterion 1

describe("Attach stats is offered where a link may be attached (criterion 1)", () => {
  it("is on /compose, closed until pressed", async () => {
    renderComposer();

    await screen.findByRole("textbox", { name: /post/i });
    expect(attachStatsButton()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: CHOICES.game })).toBeNull();
  });

  it("opens a picker with exactly the three choices", async () => {
    const { user } = renderComposer();

    await openPicker(user);

    expect(attachStatsButton()).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: CHOICES.game }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: CHOICES.playerGame }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: CHOICES.career }),
    ).toBeInTheDocument();
  });

  it("is absent from /compose?reply_to=<id>, though /compose has it", async () => {
    // Asserted against the page that does have it, so the absence is the
    // reply context's doing rather than a control that does not exist yet.
    const plain = renderWithAuth(<ComposePage />, { route: "/compose" });
    expect(
      await screen.findByRole("button", { name: /^attach stats$/i }),
    ).toBeInTheDocument();
    plain.unmount();

    renderComposer("/compose?reply_to=42");

    await screen.findByRole("textbox", { name: /post/i });
    expect(textBox()).toBeInTheDocument();
    expect(queryAttachStatsButton()).toBeNull();
  });

  it("is present on /compose?repost_of=<id>", async () => {
    renderComposer("/compose?repost_of=7");

    await screen.findByRole("textbox", { name: /post/i });
    expect(attachStatsButton()).toBeInTheDocument();
  });

  it("is absent from InlineComposer, the thread's reply box, though /compose has it", async () => {
    const plain = renderWithAuth(<ComposePage />, { route: "/compose" });
    expect(
      await screen.findByRole("button", { name: /^attach stats$/i }),
    ).toBeInTheDocument();
    plain.unmount();

    renderWithAuth(
      <InlineComposer parentPostId={101} parentUsername="raptorsfan" />,
    );

    expect(
      await screen.findByRole("textbox", { name: /your reply/i }),
    ).toBeInTheDocument();
    expect(queryAttachStatsButton()).toBeNull();
  });
});

// ----------------------------------------------------------- criterion 2

describe("Game result (criterion 2)", () => {
  it("narrows by team and season through GET /events/games?team_id&season", async () => {
    const { user, stubs } = renderComposer();

    await attachGameResult(user);

    expect(
      stubs.games.queries.some(
        (query) =>
          query.get("team_id") === "1" && query.get("season") === "2023-24",
      ),
      "no GET /events/games carried team_id=1 and season=2023-24",
    ).toBe(true);
  });

  it("does not offer a game whose scores are both 0", async () => {
    const { user } = renderComposer();

    await openPicker(user);
    await user.click(await screen.findByRole("button", { name: CHOICES.game }));
    await user.selectOptions(
      await screen.findByRole("combobox", { name: /team/i }),
      await screen.findByRole("option", { name: /Toronto Raptors/ }),
    );
    await user.selectOptions(
      await screen.findByRole("combobox", { name: /season/i }),
      await screen.findByRole("option", { name: "2023-24" }),
    );

    // Both stubbed games are Toronto against Phoenix, so every game choice
    // names the Suns; only the completed one may be there.
    await screen.findByRole("button", { name: COMPLETED_GAME_NAME });
    const gameChoices = screen.getAllByRole("button", { name: /Suns|PHX/ });
    expect(gameChoices).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /\b0\D+0\b/ })).toBeNull();
  });

  it("attaches {type: 'game_final', ref_id: <game id>}", async () => {
    const { user } = renderComposer();

    await attachGameResult(user);
    await summaryShown();
    const body = await postWithText(user);

    expect(body.data_link).toEqual({ type: "game_final", ref_id: 501 });
  });
});

// ----------------------------------------------------------- criterion 3

describe("Player's game (criterion 3)", () => {
  it("lists the chosen game's box score from GET /events/games/{id}", async () => {
    const { user, stubs } = renderComposer();

    await openPicker(user);
    await user.click(
      await screen.findByRole("button", { name: CHOICES.playerGame }),
    );
    await user.selectOptions(
      await screen.findByRole("combobox", { name: /team/i }),
      await screen.findByRole("option", { name: /Toronto Raptors/ }),
    );
    await user.selectOptions(
      await screen.findByRole("combobox", { name: /season/i }),
      await screen.findByRole("option", { name: "2023-24" }),
    );
    await user.click(
      await screen.findByRole("button", { name: COMPLETED_GAME_NAME }),
    );

    // A starter from each side.
    expect(
      await screen.findByRole("button", { name: /Barnes/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Booker/ })).toBeInTheDocument();
    expect(stubs.detail.requests).toContain(501);
  });

  it("does not offer a player who did not play", async () => {
    const { user } = renderComposer();

    await openPicker(user);
    await user.click(
      await screen.findByRole("button", { name: CHOICES.playerGame }),
    );
    await user.selectOptions(
      await screen.findByRole("combobox", { name: /team/i }),
      await screen.findByRole("option", { name: /Toronto Raptors/ }),
    );
    await user.selectOptions(
      await screen.findByRole("combobox", { name: /season/i }),
      await screen.findByRole("option", { name: "2023-24" }),
    );
    await user.click(
      await screen.findByRole("button", { name: COMPLETED_GAME_NAME }),
    );
    await screen.findByRole("button", { name: /Barnes/ });

    // The box score's did_not_play lists, on both sides…
    expect(screen.queryByRole("button", { name: /Poeltl/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Damion Lee|Lee\b/ }),
    ).toBeNull();
    // …and a stored DNP row (seconds_played null) among the players.
    expect(screen.queryByRole("button", { name: /Rowman/ })).toBeNull();
  });

  it("attaches {type: 'player_game', ref_id: <line_id>}", async () => {
    const { user } = renderComposer();

    await attachBarnesLine(user);
    await summaryShown();
    const body = await postWithText(user);

    expect(body.data_link).toEqual({
      type: "player_game",
      ref_id: BARNES_LINE_ID,
    });
  });
});

// ----------------------------------------------------------- criterion 4

describe("Player career (criterion 4)", () => {
  it("searches players by name through GET /events/players?q=", async () => {
    const { user, stubs } = renderComposer();

    await openPicker(user);
    await user.click(
      await screen.findByRole("button", { name: CHOICES.career }),
    );
    await user.type(await findPlayerSearch(), "James");

    expect(
      await screen.findByRole("button", { name: /LeBron James/ }),
    ).toBeInTheDocument();
    expect(
      stubs.players.requests.some(
        (request) => request.query.get("q") === "James",
      ),
      "no GET /events/players carried q=James",
    ).toBe(true);
  });

  it("reads the two scopes from GET /events/players/{id}", async () => {
    const { user, stubs } = renderComposer();

    await openPicker(user);
    await user.click(
      await screen.findByRole("button", { name: CHOICES.career }),
    );
    await user.type(await findPlayerSearch(), "James");
    await user.click(
      await screen.findByRole("button", { name: /LeBron James/ }),
    );

    expect(
      await screen.findByRole("button", { name: /^regular season/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^playoffs/i }),
    ).toBeInTheDocument();
    expect(
      stubs.player.requests.map((request) => request.path.player_id),
    ).toContain("2544");
  });

  it("does not offer a scope whose career line has games_played 0", async () => {
    const { user } = renderComposer("/compose", { career: noPlayoffsCareer() });

    await openPicker(user);
    await user.click(
      await screen.findByRole("button", { name: CHOICES.career }),
    );
    await user.type(await findPlayerSearch(), "James");
    await user.click(
      await screen.findByRole("button", { name: /LeBron James/ }),
    );

    expect(
      await screen.findByRole("button", { name: /^regular season/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^playoffs/i })).toBeNull();
  });

  it("attaches {type: 'player_career', ref_id: <player id>, scope}", async () => {
    const { user } = renderComposer();

    await attachLebronCareer(user, /^playoffs/i);
    await summaryShown();
    const body = await postWithText(user);

    expect(body.data_link).toEqual({
      type: "player_career",
      ref_id: 2544,
      scope: "playoffs",
    });
  });
});

// ----------------------------------------------------------- criterion 5

describe("the attachment's summary (criterion 5)", () => {
  it("names a game result by its teams, score and date", async () => {
    const { user } = renderComposer();

    await attachGameResult(user);
    const summary = textOf(await summaryShown());

    expect(summary).toMatch(/Raptors|TOR/);
    expect(summary).toMatch(/Suns|PHX/);
    expect(summary).toMatch(/\b117\b/);
    expect(summary).toMatch(/\b109\b/);
    expect(summary).toMatch(/2024/);
  });

  it("names a player's game by player, team, opponent, date and points", async () => {
    const { user } = renderComposer();

    await attachBarnesLine(user);
    const summary = textOf(await summaryShown());

    expect(summary).toMatch(/Barnes/);
    expect(summary).toMatch(/Raptors|TOR/);
    expect(summary).toMatch(/Suns|PHX/);
    expect(summary).toMatch(/2024/);
    expect(summary).toMatch(/\b22\b/);
    expect(summary).toMatch(/pts|points/i);
  });

  it("names a career by player, scope and games played", async () => {
    const { user } = renderComposer();

    await attachLebronCareer(user);
    const summary = textOf(await summaryShown());

    expect(summary).toMatch(/LeBron James/);
    expect(summary).toMatch(/regular season/i);
    expect(summary).toMatch(/1,?492/);
    expect(summary).toMatch(/games|GP/i);
  });

  it("shows nothing before anything is attached", async () => {
    renderComposer();

    await screen.findByRole("textbox", { name: /post/i });
    expect(attachedSummary()).toBeNull();
    expect(screen.queryByRole("button", { name: /^undo/i })).toBeNull();
  });

  it("Remove clears the attachment, and the post goes without one", async () => {
    const { user } = renderComposer();

    await attachGameResult(user);
    const summary = await summaryShown();
    await user.click(within(summary).getByRole("button", { name: /^remove/i }));

    await waitFor(() => expect(attachedSummary()).toBeNull());
    const body = await postWithText(user);
    expect(body.data_link ?? null).toBeNull();
  });

  it("attaching again replaces the link rather than adding a second", async () => {
    const { user } = renderComposer();

    await attachGameResult(user);
    await summaryShown();
    await attachBarnesLine(user);

    await waitFor(() =>
      expect(textOf(attachedSummary() as HTMLElement)).toMatch(/Barnes/),
    );
    expect(
      screen.getAllByRole("region", { name: /^attached stats$/i }),
    ).toHaveLength(1);
    const body = await postWithText(user);
    expect(body.data_link).toEqual({
      type: "player_game",
      ref_id: BARNES_LINE_ID,
    });
  });

  it("Undo restores the attachment from before the last replace, then none", async () => {
    const { user } = renderComposer();

    await attachGameResult(user);
    await summaryShown();
    await attachBarnesLine(user);
    await waitFor(() =>
      expect(textOf(attachedSummary() as HTMLElement)).toMatch(/Barnes/),
    );

    // Undo the replace: back to the game result.
    await user.click(undoButton());
    await waitFor(() => {
      const summary = textOf(attachedSummary() as HTMLElement);
      expect(summary).not.toMatch(/Barnes/);
      expect(summary).toMatch(/\b117\b/);
    });

    // Undo the first attach: back to nothing.
    await user.click(undoButton());
    await waitFor(() => expect(attachedSummary()).toBeNull());

    const body = await postWithText(user);
    expect(body.data_link ?? null).toBeNull();
  });

  it("Undo keeps the text typed before the attach", async () => {
    const { user } = renderComposer();

    await user.type(textBox(), "Called it");
    await attachGameResult(user);
    await summaryShown();
    await user.click(undoButton());

    await waitFor(() => expect(attachedSummary()).toBeNull());
    expect(textBox()).toHaveValue("Called it");
  });

  it("the Undo control is not the removed Undo mention", async () => {
    const { user } = renderComposer();

    await attachGameResult(user);
    await summaryShown();

    expect(screen.queryByRole("button", { name: /undo mention/i })).toBeNull();
    expect(undoButton()).toBeInTheDocument();
  });
});

// ------------------------------------------------- criterion 12, keyboard

describe("the picker by keyboard alone (criterion 12)", () => {
  it("opens from Attach stats and moves focus into the panel", async () => {
    const { user } = renderComposer();
    await screen.findByRole("textbox", { name: /post/i });

    attachStatsButton().focus();
    await user.keyboard("{Enter}");

    expect(attachStatsButton()).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => {
      expect(document.activeElement).not.toBe(attachStatsButton());
      expect(document.activeElement).not.toBe(document.body);
    });
  });

  it("reaches every choice by Tab", async () => {
    const { user } = renderComposer();
    await screen.findByRole("textbox", { name: /post/i });

    attachStatsButton().focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("button", { name: CHOICES.game });

    const reached = new Set<Element | null>([document.activeElement]);
    for (let step = 0; step < 6; step += 1) {
      await user.tab();
      reached.add(document.activeElement);
    }

    for (const choice of Object.values(CHOICES)) {
      expect(
        reached.has(screen.getByRole("button", { name: choice })),
        String(choice),
      ).toBe(true);
    }
  });

  it("reaches the team and season selects by Tab after Game result", async () => {
    const { user } = renderComposer();
    await screen.findByRole("textbox", { name: /post/i });

    attachStatsButton().focus();
    await user.keyboard("{Enter}");
    const game = await screen.findByRole("button", { name: CHOICES.game });
    game.focus();
    await user.keyboard("{Enter}");
    const team = await screen.findByRole("combobox", { name: /team/i });
    const season = await screen.findByRole("combobox", { name: /season/i });

    const reached = new Set<Element | null>([document.activeElement]);
    for (let step = 0; step < 8; step += 1) {
      await user.tab();
      reached.add(document.activeElement);
    }

    expect(reached.has(team), "Team select").toBe(true);
    expect(reached.has(season), "Season select").toBe(true);
  });

  it("closes on Escape and returns focus to Attach stats", async () => {
    const { user } = renderComposer();
    await screen.findByRole("textbox", { name: /post/i });

    attachStatsButton().focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("button", { name: CHOICES.game });
    await user.tab();
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: CHOICES.game })).toBeNull(),
    );
    expect(attachStatsButton()).toHaveAttribute("aria-expanded", "false");
    expect(attachStatsButton()).toHaveFocus();
  });

  it("returns focus to Attach stats when a choice attaches and the picker closes", async () => {
    const { user } = renderComposer();

    await attachGameResult(user);
    await summaryShown();

    await waitFor(() => expect(attachStatsButton()).toHaveFocus());
    expect(attachStatsButton()).toHaveAttribute("aria-expanded", "false");
  });
});
