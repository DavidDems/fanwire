/**
 * FRONTEND-037: the team level's result cards through the navigator itself,
 * with no router (the Stats route's own links are
 * `features/stats/season-results.test.tsx`'s).
 *
 * The interface this file pins:
 *
 * - `StatsNavAdapter.gameLink(gameId, children, season?)`: the team level
 *   passes its own season as the third argument, so a route adapter can carry
 *   it to the game page. The card (its matchup, result, score and game) is the
 *   link's `children`.
 * - In select mode with no `levelHref` (the compose picker), each card is one
 *   button whose plain click opens the game's level, named as the link is: the
 *   matchup with the selected team first, "Won" or "Lost", and the score.
 * - Either way, each list item holds exactly one interactive element: the
 *   opponent is no longer a link of its own.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { teamsAre } from "../../test/auth";
import { createTestQueryClient } from "../../test/render";
import { server } from "../../test/server";
import {
  CELTICS,
  championStub,
  seasonsStub,
  standingsStub,
  statsTeams,
  teamSeasonStub,
  testChampion,
  testTeamSeason,
} from "../../test/stats";
import {
  StatsNavigator,
  type StatsLevel,
  type StatsNavAdapter,
} from "./StatsNavigator";

const SEASON = "2023-24";
const EN_DASH = String.fromCodePoint(0x2013);

const TEAM_STACK: StatsLevel[] = [
  { kind: "season", season: SEASON, conf: "all" },
  { kind: "team", season: SEASON, teamId: CELTICS.id },
];

function arrange() {
  server.use(
    teamsAre(statsTeams()),
    seasonsStub().handler,
    championStub({ [SEASON]: testChampion(SEASON) }).handler,
    standingsStub().handler,
    teamSeasonStub().handler,
  );
}

function Harness({
  adapter,
  selectMode = false,
  opened,
}: {
  adapter: StatsNavAdapter;
  selectMode?: boolean;
  opened: StatsLevel[];
}) {
  const [stack, setStack] = useState<StatsLevel[]>(TEAM_STACK);
  return (
    <main>
      <StatsNavigator
        stack={stack}
        adapter={adapter}
        selectMode={selectMode}
        open={(level) => {
          opened.push(level);
          setStack((current) => [...current, level]);
        }}
        replace={(level) =>
          setStack((current) => [...current.slice(0, -1), level])
        }
        pop={(toDepth) => setStack((current) => current.slice(0, toDepth))}
        levelViews={{
          name: (level) =>
            level.kind === "game" ? `Game ${level.gameId}` : null,
          view: (level) =>
            level.kind === "game" ? <p>Game level {level.gameId}</p> : null,
        }}
      />
    </main>
  );
}

function renderTeam(adapter: StatsNavAdapter, selectMode = false) {
  arrange();
  const opened: StatsLevel[] = [];
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <Harness adapter={adapter} selectMode={selectMode} opened={opened} />
    </QueryClientProvider>,
  );
  return { opened };
}

/** The list of result cards: its items are named for a win or a loss. */
async function resultItems(): Promise<HTMLElement[]> {
  let found: HTMLElement[] = [];
  await waitFor(() => {
    const list = screen.queryAllByRole("list").find((candidate) =>
      within(candidate)
        .queryAllByRole("listitem")
        .some((item) =>
          [
            ...within(item).queryAllByRole("link"),
            ...within(item).queryAllByRole("button"),
          ].some((control) =>
            /\b(Won|Lost)\b/.test(
              control.getAttribute("aria-label") ?? control.textContent ?? "",
            ),
          ),
        ),
    );
    expect(list, "a list of result cards").toBeDefined();
    found = within(list as HTMLElement).getAllByRole("listitem");
  });
  return found;
}

describe("the team level hands its season to the adapter's game link", () => {
  it("calls gameLink with each game, newest first, and the level's season", async () => {
    const calls: { gameId: number; season: string | undefined }[] = [];
    const adapter: StatsNavAdapter = {
      gameLink: (gameId: number, children: ReactNode, season?: string) => {
        calls.push({ gameId, season });
        return <a href={`#game-${gameId}`}>{children}</a>;
      },
      playerLink: (playerId: number, children: ReactNode) => (
        <a href={`#player-${playerId}`}>{children}</a>
      ),
    };
    renderTeam(adapter);

    const items = await resultItems();
    const games = testTeamSeason(CELTICS, SEASON).games;
    expect(items).toHaveLength(games.length);
    items.forEach((item, index) => {
      expect(within(item).queryAllByRole("button")).toEqual([]);
      const links = within(item).getAllByRole("link");
      expect(links, "one link per card").toHaveLength(1);
      expect(links[0]).toHaveAttribute("href", `#game-${games[index].game_id}`);
    });
    const gameCalls = calls.filter((call) =>
      games.some((game) => game.game_id === call.gameId),
    );
    expect(gameCalls.length).toBeGreaterThanOrEqual(games.length);
    expect(new Set(gameCalls.map((call) => call.season))).toEqual(
      new Set([SEASON]),
    );
  });
});

describe("in select mode with no addresses (the picker), each card is a button", () => {
  const pickerAdapter: StatsNavAdapter = {
    gameLink: (_gameId: number, children: ReactNode) => children,
    playerLink: (_playerId: number, children: ReactNode) => children,
  };

  it("is one button per card, named for the matchup, result and score, and opens the game", async () => {
    const { opened } = renderTeam(pickerAdapter, true);
    const user = userEvent.setup();

    const items = await resultItems();
    for (const item of items) {
      expect(within(item).queryAllByRole("link")).toEqual([]);
      expect(within(item).getAllByRole("button")).toHaveLength(1);
    }
    const away = within(items[1]).getByRole("button");
    expect(away).toHaveAccessibleName(
      expect.stringContaining("Celtics at Suns"),
    );
    expect(away).toHaveAccessibleName(/\bLost\b/);
    expect(away).toHaveAccessibleName(
      expect.stringContaining(`111${EN_DASH}117`),
    );

    const home = within(items[0]).getByRole("button");
    expect(home).toHaveAccessibleName(
      expect.stringContaining("Celtics vs Mavericks"),
    );
    expect(home).toHaveAccessibleName(/\bWon\b/);
    await user.click(home);

    expect(opened).toEqual([{ kind: "game", gameId: 9101 }]);
    expect(await screen.findByText("Game level 9101")).toBeVisible();
  });
});
