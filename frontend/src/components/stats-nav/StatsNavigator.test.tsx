/**
 * FRONTEND-018: the shared stats navigator, driven by a **state adapter**
 * written here (React state, no router mounted), which is what FRONTEND-021's
 * compose picker will be. The Stats page's route adapter is pinned through the
 * real route table in `features/stats/`.
 *
 * ## The interface this file defines (the implementation follows it)
 *
 * `components/stats-nav/StatsNavigator.tsx` exports:
 *
 * ```ts
 * type Conference = "all" | "east" | "west";
 * // Levels are data; the union may grow (FRONTEND-021 adds game, box score).
 * type StatsLevel =
 *   | { kind: "season"; season: string; conf: Conference }
 *   | { kind: "team"; season: string; teamId: number }
 *   | ...; // FRONTEND-019 adds the records levels, which carry no season
 *          // (their shapes are the implementation's; every use narrows by kind)
 *
 * interface StatsNavAdapter {
 *   // How a game or a player is linked: the route adapter renders a router
 *   // <Link>, a picker something else. `children` is the link's text.
 *   gameLink(gameId: number, children: ReactNode): ReactNode;
 *   playerLink(playerId: number, children: ReactNode): ReactNode;
 *   // Optional: the address of a level. When given, a control that opens or
 *   // returns to a level is an <a href={levelHref(level)}> whose plain click
 *   // calls open / pop (preventDefault); when absent it is a <button>.
 *   levelHref?(level: StatsLevel): string;
 *   // FRONTEND-019, optional: a team's link, for that season or none; without
 *   // it a team's name is plain text. This file's picker adapter has none.
 *   teamLink?(teamId: number, season: string | null, children: ReactNode): ReactNode;
 * }
 *
 * interface StatsNavigatorProps {
 *   stack: StatsLevel[];              // non-empty; the last is shown
 *   open(level: StatsLevel): void;    // push a level (a standings team)
 *   replace(level: StatsLevel): void; // swap the top (the conference tab)
 *   pop(toDepth: number): void;       // keep the first toDepth levels
 *   adapter: StatsNavAdapter;
 * }
 * function StatsNavigator(props: StatsNavigatorProps): JSX.Element;
 * ```
 *
 * `components/stats-nav/PlayerResults.tsx` exports
 * `PlayerResults({ q, adapter }: { q: string; adapter: StatsNavAdapter })`:
 * the Players search's results for a non-empty `q` (a "Results" region, rows
 * named by the player, linked through `adapter.playerLink`, Load more).
 *
 * What the frame renders:
 *
 * - **Breadcrumb**: a `<nav>` named "Stats path" holding an `<ol>`, one item
 *   per level (the season's text is the season, a team's is the team's name);
 *   every item but the last is a control that calls `pop(index + 1)`; the last
 *   carries `aria-current="location"`.
 * - **Back**: a button named "Back", only when the stack is deeper than one,
 *   calling `pop(stack.length - 1)`.
 * - **The current level's view**, starting with a heading with tabIndex -1
 *   that names the level (contains the season, or the team's name). When a
 *   level is opened or popped, focus moves to it; not on the first render.
 * - **Season level**: a "Champion" region, then a "Standings" region holding
 *   a `SegmentedTabs` bar named "Conference" (All / East / West), whose panel
 *   holds the tables: All both conferences, East and West one each, filtered
 *   on the client from the one standings read. A tab calls
 *   `replace({ ...level, conf })`. Each team's row header opens its team level.
 * - **Team season level**: the record and the home and away splits, then its
 *   games newest first (the API's order), each linked by `adapter.gameLink`.
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
  MAVERICKS,
  testPlayerListItem,
  championStub,
  leadersStub,
  playersStub,
  seasonsStub,
  standingsStub,
  statsTeams,
  teamSeasonStub,
  testChampion,
  testTeamSeason,
  type PlayerListItemOut,
} from "../../test/stats";
import { bodyRows, rowText, tableProblems } from "../../test/tables";
import { PlayerResults } from "./PlayerResults";
import {
  StatsNavigator,
  type StatsLevel,
  type StatsNavAdapter,
} from "./StatsNavigator";

const SEASON = "2023-24";

const HARDEN = testPlayerListItem({
  id: 201935,
  first_name: "James",
  last_name: "Harden",
  latest_team_abbreviation: "LAC",
});
const LEBRON = testPlayerListItem();

function arrange() {
  const teamSeason = teamSeasonStub();
  const players = playersStub((q) => (q === "james" ? [HARDEN, LEBRON] : []));
  server.use(
    teamsAre(statsTeams()),
    seasonsStub().handler,
    championStub({ [SEASON]: testChampion(SEASON) }).handler,
    standingsStub().handler,
    leadersStub().handler,
    teamSeason.handler,
    players.handler,
  );
  return { teamSeason, players };
}

/** The picker's shape: links that are not routes. */
const pickerAdapter: StatsNavAdapter = {
  gameLink: (gameId: number, children: ReactNode) => (
    <a href={`#game-${gameId}`}>{children}</a>
  ),
  playerLink: (playerId: number, children: ReactNode) => (
    <a href={`#player-${playerId}`}>{children}</a>
  ),
};

interface Calls {
  open: StatsLevel[];
  replace: StatsLevel[];
  pop: number[];
}

/** A state adapter: the stack lives in React state, and no router is mounted. */
function StateAdapter({
  initial,
  calls,
  adapter = pickerAdapter,
}: {
  initial: StatsLevel[];
  calls: Calls;
  adapter?: StatsNavAdapter;
}) {
  const [stack, setStack] = useState<StatsLevel[]>(initial);
  return (
    <main>
      <StatsNavigator
        stack={stack}
        adapter={adapter}
        open={(level) => {
          calls.open.push(level);
          setStack((current) => [...current, level]);
        }}
        replace={(level) => {
          calls.replace.push(level);
          setStack((current) => [...current.slice(0, -1), level]);
        }}
        pop={(toDepth) => {
          calls.pop.push(toDepth);
          setStack((current) => current.slice(0, toDepth));
        }}
      />
    </main>
  );
}

function renderState(
  initial: StatsLevel[] = [{ kind: "season", season: SEASON, conf: "all" }],
  adapter?: StatsNavAdapter,
) {
  const calls: Calls = { open: [], replace: [], pop: [] };
  const stubs = arrange();
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <StateAdapter initial={initial} calls={calls} adapter={adapter} />
    </QueryClientProvider>,
  );
  return { calls, ...stubs };
}

function breadcrumb(): HTMLElement {
  return screen.getByRole("navigation", { name: "Stats path" });
}

function crumbs(): HTMLElement[] {
  const nav = breadcrumb();
  const list = nav.querySelector("ol");
  if (list === null) throw new Error("the breadcrumb holds no ordered list");
  return within(list).getAllByRole("listitem");
}

function controlIn(item: HTMLElement): HTMLElement | null {
  return (
    within(item).queryAllByRole("button")[0] ??
    within(item).queryAllByRole("link")[0] ??
    null
  );
}

function backButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: /^back\b/i });
}

function conferenceTabs(): HTMLElement {
  return screen.getByRole("tablist", { name: "Conference" });
}

function selectedTab(): string {
  const tab = within(conferenceTabs())
    .getAllByRole("tab")
    .find((t) => t.getAttribute("aria-selected") === "true");
  return tab?.textContent?.trim() ?? "";
}

async function standingsTables(): Promise<HTMLElement[]> {
  const panel = await screen.findByRole("tabpanel");
  return within(panel).findAllByRole("table");
}

function captions(tables: HTMLElement[]): string[] {
  return tables.map((t) => t.querySelector("caption")?.textContent ?? "");
}

function focusedHeading(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  if (active === null || !/^H[1-6]$/.test(active.tagName)) return null;
  return active;
}

async function openBoston(user: ReturnType<typeof userEvent.setup>) {
  const standings = await screen.findByRole("region", { name: "Standings" });
  await within(standings).findAllByRole("table");
  const control =
    within(standings).queryByRole("button", {
      name: new RegExp(CELTICS.name),
    }) ??
    within(standings).getByRole("link", { name: new RegExp(CELTICS.name) });
  await user.click(control);
  await screen.findByRole("heading", { name: new RegExp(CELTICS.name) });
}

describe("the season level, through a state adapter (no router)", () => {
  it("shows the champion, then the standings under an All / East / West bar, All selected", async () => {
    renderState();

    const champion = await screen.findByRole("region", { name: "Champion" });
    await within(champion).findByText(new RegExp(CELTICS.name));
    expect(champion.textContent).toContain(MAVERICKS.name);

    const standings = await screen.findByRole("region", { name: "Standings" });
    expect(
      within(standings).getByRole("tablist", { name: "Conference" }),
    ).toBeVisible();
    expect(
      within(conferenceTabs())
        .getAllByRole("tab")
        .map((t) => t.textContent?.trim()),
    ).toEqual(["All", "East", "West"]);
    expect(selectedTab()).toBe("All");

    const tables = await standingsTables();
    expect(tables).toHaveLength(2);
    expect(captions(tables).join(" ")).toMatch(/eastern/i);
    expect(captions(tables).join(" ")).toMatch(/western/i);
    // The champion comes before the standings.
    expect(
      champion.compareDocumentPosition(standings) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(tableProblems(standings)).toEqual([]);
  });

  it("filters the one standings read: East and West show one conference each", async () => {
    const { calls } = renderState();
    const user = userEvent.setup();
    await standingsTables();

    await user.click(
      within(conferenceTabs()).getByRole("tab", { name: "East" }),
    );
    await waitFor(() => expect(selectedTab()).toBe("East"));
    let tables = await standingsTables();
    expect(tables).toHaveLength(1);
    expect(captions(tables)[0]).toMatch(/eastern/i);

    await user.click(
      within(conferenceTabs()).getByRole("tab", { name: "West" }),
    );
    await waitFor(() => expect(selectedTab()).toBe("West"));
    tables = await standingsTables();
    expect(tables).toHaveLength(1);
    expect(captions(tables)[0]).toMatch(/western/i);

    expect(calls.replace).toEqual([
      { kind: "season", season: SEASON, conf: "east" },
      { kind: "season", season: SEASON, conf: "west" },
    ]);
    expect(calls.open).toEqual([]);
  });

  it("moves between conferences with the arrow keys (one tab stop)", async () => {
    renderState();
    const user = userEvent.setup();
    await standingsTables();

    within(conferenceTabs()).getByRole("tab", { name: "All" }).focus();
    await user.keyboard("{ArrowRight}");

    await waitFor(() => expect(selectedTab()).toBe("East"));
    expect(
      within(conferenceTabs())
        .getAllByRole("tab")
        .filter((t) => t.getAttribute("tabindex") === "0"),
    ).toHaveLength(1);
  });

  it("opens on a conference the stack names", async () => {
    renderState([{ kind: "season", season: SEASON, conf: "west" }]);

    const tables = await standingsTables();
    expect(selectedTab()).toBe("West");
    expect(tables).toHaveLength(1);
    expect(captions(tables)[0]).toMatch(/western/i);
  });

  it("has a one-item breadcrumb marked current, no Back, and moves no focus on first render", async () => {
    renderState();
    await standingsTables();

    const nav = breadcrumb();
    expect(nav.querySelector("ol")).not.toBeNull();
    const items = crumbs();
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain(SEASON);
    expect(
      items[0].getAttribute("aria-current") === "location" ||
        items[0].querySelector('[aria-current="location"]') !== null,
    ).toBe(true);
    expect(backButton()).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("Season → Team season → Back, through a state adapter", () => {
  it("a standings team opens its team level, with the season › team breadcrumb and Back", async () => {
    const { calls, teamSeason } = renderState();
    const user = userEvent.setup();

    await openBoston(user);

    expect(calls.open).toEqual([
      { kind: "team", season: SEASON, teamId: CELTICS.id },
    ]);
    await waitFor(() =>
      expect(teamSeason.requests.map((r) => r.path)).toEqual([
        { team_id: String(CELTICS.id), season: SEASON },
      ]),
    );
    const items = crumbs();
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain(SEASON);
    expect(controlIn(items[0])).not.toBeNull();
    expect(items[1].textContent).toContain(CELTICS.name);
    expect(
      items[1].getAttribute("aria-current") === "location" ||
        items[1].querySelector('[aria-current="location"]') !== null,
    ).toBe(true);
    expect(items[0].querySelector('[aria-current="location"]')).toBeNull();
    expect(items[0].getAttribute("aria-current")).toBeNull();
    expect(backButton()).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Standings" })).toBeNull();
  });

  it("shows the team's record, splits and games newest first, linked through the adapter", async () => {
    renderState();
    const user = userEvent.setup();
    await openBoston(user);

    const main = screen.getByRole("main");
    await waitFor(() => expect(rowText(main)).toMatch(/64\s*[-–]\s*18/));
    expect(rowText(main)).toMatch(/37\s*[-–]\s*4\b/);
    expect(rowText(main)).toMatch(/27\s*[-–]\s*14/);

    const hrefs = [
      ...new Set(
        within(main)
          .getAllByRole("link")
          .map((link) => link.getAttribute("href") ?? "")
          .filter((href) => href.startsWith("#game-")),
      ),
    ];
    expect(hrefs).toEqual(
      testTeamSeason().games.map((g) => `#game-${g.game_id}`),
    );
    const table = within(main).getByRole("table", {
      name: /Boston Celtics games, 2023-24, newest first/i,
    });
    expect(bodyRows(table as HTMLTableElement)).toHaveLength(3);
    expect(tableProblems(main)).toEqual([]);
  });

  it("moves focus to the team level's heading when it opens", async () => {
    renderState();
    const user = userEvent.setup();
    await openBoston(user);

    await waitFor(() => {
      const heading = focusedHeading();
      expect(heading, "focus is on no heading").not.toBeNull();
      expect(heading?.textContent ?? "").toContain(CELTICS.name);
      expect(heading).toHaveAttribute("tabindex", "-1");
    });
  });

  it("Back pops to the season level, on the conference it was on, focus on its heading", async () => {
    const { calls } = renderState([
      { kind: "season", season: SEASON, conf: "east" },
    ]);
    const user = userEvent.setup();
    await openBoston(user);

    await user.click(backButton() as HTMLElement);

    expect(calls.pop).toEqual([1]);
    await waitFor(() => expect(selectedTab()).toBe("East"));
    expect(await standingsTables()).toHaveLength(1);
    expect(backButton()).toBeNull();
    expect(crumbs()).toHaveLength(1);
    await waitFor(() => {
      const heading = focusedHeading();
      expect(heading, "focus is on no heading").not.toBeNull();
      expect(heading?.textContent ?? "").toContain(SEASON);
      expect(heading).toHaveAttribute("tabindex", "-1");
    });
  });

  it("the breadcrumb's season item returns to the season level", async () => {
    const { calls } = renderState();
    const user = userEvent.setup();
    await openBoston(user);

    await user.click(controlIn(crumbs()[0]) as HTMLElement);

    expect(calls.pop).toEqual([1]);
    expect(
      await screen.findByRole("region", { name: "Standings" }),
    ).toBeVisible();
    expect(crumbs()).toHaveLength(1);
  });

  it("the breadcrumb and Back are reachable by keyboard", async () => {
    const { calls } = renderState();
    const user = userEvent.setup();
    await openBoston(user);

    const back = backButton() as HTMLElement;
    back.focus();
    expect(document.activeElement).toBe(back);
    await user.keyboard("{Enter}");
    expect(calls.pop).toEqual([1]);
  });
});

describe("an adapter that gives levels an address", () => {
  it("renders level controls as links to that address, whose plain click opens the level", async () => {
    // FRONTEND-019 changed this adapter's typing: the StatsLevel union grew
    // (the records levels carry no season), so it narrows by kind.
    const withHref: StatsNavAdapter = {
      ...pickerAdapter,
      levelHref: (level: StatsLevel) =>
        level.kind === "team"
          ? `/somewhere?team=${level.teamId}`
          : level.kind === "season"
            ? `/somewhere?season=${level.season}`
            : "/somewhere",
    };
    const { calls } = renderState(undefined, withHref);
    const user = userEvent.setup();

    const standings = await screen.findByRole("region", { name: "Standings" });
    await within(standings).findAllByRole("table");
    const link = within(standings).getByRole("link", {
      name: new RegExp(CELTICS.name),
    });
    expect(link).toHaveAttribute("href", `/somewhere?team=${CELTICS.id}`);

    await user.click(link);

    expect(calls.open).toEqual([
      { kind: "team", season: SEASON, teamId: CELTICS.id },
    ]);
    await screen.findByRole("heading", { name: new RegExp(CELTICS.name) });
  });
});

describe("Players → results, through a state adapter", () => {
  function PlayersHarness() {
    const [text, setText] = useState("");
    const [q, setQ] = useState("");
    return (
      <main>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setQ(text.trim());
          }}
        >
          <label>
            Find
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <button type="submit">Go</button>
        </form>
        {q === "" ? null : <PlayerResults q={q} adapter={pickerAdapter} />}
      </main>
    );
  }

  function nameOf(player: PlayerListItemOut): string {
    return [player.first_name, player.last_name].filter(Boolean).join(" ");
  }

  it("asks nothing until a search, then lists the players through the adapter, in the API's order", async () => {
    const { players } = arrange();
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <PlayersHarness />
      </QueryClientProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(players.requests).toHaveLength(0);

    await user.type(screen.getByRole("textbox", { name: "Find" }), "james");
    await user.click(screen.getByRole("button", { name: "Go" }));

    const results = await screen.findByRole("region", { name: "Results" });
    await waitFor(() =>
      expect(
        within(results)
          .queryAllByRole("link")
          .map((l) => l.getAttribute("href")),
      ).toEqual([`#player-${HARDEN.id}`, `#player-${LEBRON.id}`]),
    );
    expect(
      within(results).getByRole("link", { name: new RegExp(nameOf(HARDEN)) }),
    ).toBeVisible();
    expect(players.requests.map((r) => r.query.get("q"))).toEqual(["james"]);
  });
});
