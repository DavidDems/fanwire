/**
 * FRONTEND-018, Baseline (c): only what is viewed is loaded. Every request the
 * app sends is counted with msw's own `request:start` event, through the real
 * route table, as a guest, with the test kit's query client (staleTime 0), so
 * every zero below comes from the season reads' own `staleTime` (300,000 ms,
 * in `api/stats.ts`), not from the client.
 *
 * The counts, exactly:
 *
 * - a cold `/stats/seasons` makes **7**: seasons, teams, champion, standings
 *   and the three leader boards (whose rule line shares the points read).
 *   Before this unit it made **8**: the same seven and the season's games page
 *   (`GET /events/games`), which is dropped;
 * - switching to East, West and back to All makes 0;
 * - opening a team makes 1 (its season), and Back to the season makes 0;
 * - a cold `/stats/seasons?team=<id>` makes 3 (seasons, teams, its season),
 *   and Back from it makes 5 (champion, standings, the three boards);
 * - `/stats/players` makes 0 until a query is typed, and one debounced query
 *   makes 1.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { teamsAre } from "../../test/auth";
import { renderAppAt } from "../../test/app-route";
import { server } from "../../test/server";
import {
  CELTICS,
  championStub,
  leadersStub,
  playersStub,
  seasonGamesStub,
  seasonGames,
  seasonsStub,
  standingsStub,
  statsTeams,
  teamSeasonStub,
  testChampion,
  testPlayerListItem,
} from "../../test/stats";

/** Every request msw saw, as `METHOD path?query`, in order. */
let sent: string[] = [];

function record({ request }: { request: Request }): void {
  const url = new URL(request.url);
  sent.push(`${request.method} ${url.pathname}${url.search}`);
}

beforeEach(() => {
  sent = [];
  server.events.on("request:start", record);
});

afterEach(() => {
  server.events.removeListener("request:start", record);
});

/** The requests sent from here on, once the screen has gone quiet. */
async function quietAfter(mark: number): Promise<string[]> {
  let last = -1;
  // Quiet: no new request over two settles in a row.
  while (last !== sent.length) {
    last = sent.length;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return sent.slice(mark);
}

function open(path: string) {
  return renderAppAt(path, "anonymous", [
    teamsAre(statsTeams()),
    seasonsStub().handler,
    championStub({ "2023-24": testChampion("2023-24") }).handler,
    standingsStub().handler,
    leadersStub().handler,
    seasonGamesStub({ "2024-25": seasonGames("2024-25", 3) }).handler,
    teamSeasonStub().handler,
    playersStub((q) => (q === "jam" ? [testPlayerListItem()] : [])).handler,
  ]);
}

async function seasonLevelLoaded(): Promise<void> {
  const standings = await screen.findByRole("region", { name: "Standings" });
  await within(standings).findAllByRole("table");
  const leaders = await screen.findByRole("region", { name: "Leaders" });
  await waitFor(() =>
    expect(within(leaders).getAllByRole("table")).toHaveLength(3),
  );
}

function conferenceTab(name: string): HTMLElement {
  return within(screen.getByRole("tablist", { name: "Conference" })).getByRole(
    "tab",
    {
      name,
    },
  );
}

function backButton(): HTMLElement {
  return screen.getByRole("button", { name: /^back\b/i });
}

describe("requests per screen (Baseline c)", () => {
  it("a cold /stats/seasons as a guest makes 7 (before: 8, with the games page)", async () => {
    open("/stats/seasons");
    await seasonLevelLoaded();

    const requests = await quietAfter(0);
    expect(requests, requests.join("\n")).toHaveLength(7);
    expect(requests.filter((r) => r.includes("/events/games"))).toEqual([]);
  });

  it("switching to East, West and back to All makes 0", async () => {
    open("/stats/seasons");
    const user = userEvent.setup();
    await seasonLevelLoaded();
    const mark = (await quietAfter(0)).length;

    await user.click(conferenceTab("East"));
    await user.click(conferenceTab("West"));
    await user.click(conferenceTab("All"));
    await seasonLevelLoaded();

    const requests = await quietAfter(mark);
    expect(requests, requests.join("\n")).toEqual([]);
  });

  it("opening a team makes 1 (its season), and Back to the season makes 0", async () => {
    open("/stats/seasons");
    const user = userEvent.setup();
    await seasonLevelLoaded();
    let mark = (await quietAfter(0)).length;

    const standings = screen.getByRole("region", { name: "Standings" });
    await user.click(
      within(standings).getByRole("link", { name: new RegExp(CELTICS.name) }),
    );
    await screen.findByRole("heading", { name: new RegExp(CELTICS.name) });

    let requests = await quietAfter(mark);
    expect(requests, requests.join("\n")).toHaveLength(1);
    expect(requests[0]).toMatch(
      new RegExp(`/events/teams/${CELTICS.id}/seasons/`),
    );
    mark = sent.length;

    await user.click(backButton());
    await seasonLevelLoaded();

    requests = await quietAfter(mark);
    expect(requests, requests.join("\n")).toEqual([]);
  });

  it("a cold /stats/seasons?team=<id> makes 3, and Back from it makes 5", async () => {
    open(`/stats/seasons?team=${CELTICS.id}`);
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: new RegExp(CELTICS.name) });

    let requests = await quietAfter(0);
    expect(requests, requests.join("\n")).toHaveLength(3);
    expect(
      requests.filter((r) => /\/events\/teams\/\d+\/seasons\//.test(r)),
    ).toHaveLength(1);
    const mark = sent.length;

    await user.click(backButton());
    await seasonLevelLoaded();

    requests = await quietAfter(mark);
    expect(requests, requests.join("\n")).toHaveLength(5);
    expect(requests.filter((r) => /\/champion/.test(r))).toHaveLength(1);
    expect(requests.filter((r) => /\/standings/.test(r))).toHaveLength(1);
    expect(requests.filter((r) => /\/leaders/.test(r))).toHaveLength(3);
  });

  it("/stats/players makes 0 until a query is typed, and one debounced query makes 1", async () => {
    open("/stats/players");
    const user = userEvent.setup();
    const box = await screen.findByRole("searchbox", {
      name: "Search players",
    });

    let requests = await quietAfter(0);
    expect(requests, requests.join("\n")).toEqual([]);

    await user.type(box, "jam");
    await screen.findByRole("link", { name: /LeBron James/ });

    requests = await quietAfter(0);
    expect(requests, requests.join("\n")).toHaveLength(1);
    expect(requests[0]).toMatch(/\/events\/players\?.*q=jam/);
  });
});
