/**
 * FRONTEND-019, Baseline (c), R11: requests per screen on the Records tab.
 * Every request the app sends is counted with msw's own `request:start`
 * event, through the real route table, as a guest, with the test kit's query
 * client (staleTime 0), so every zero below comes from the records reads' own
 * `staleTime: Infinity` (`api/records.ts`) or the season reads' five minutes,
 * not from the client.
 *
 * The counts, exactly (`EVENTS-012` splits the summary into the catalog and
 * one holders read, `GET /events/records/holders?ids=`, its ids sorted,
 * distinct and at most 24):
 *
 * - a cold `/stats/records` makes **2**: `GET /events/records`, then one
 *   holders read for the sixteen Top records, their ids sorted
 *   (`FRONTEND-030`: Top records is the default);
 * - switching to Team makes 1 and to Player 1, each a holders read for that
 *   group's first page of 24, and switching back to either, or to Top
 *   records, makes 0;
 * - Load more makes exactly 1, a holders read for the next 24, sorted;
 * - opening a card makes exactly 1, `GET /events/records/<id>?limit=100`;
 * - Back makes 0, and opening the same card again makes 0;
 * - a cold `/stats/records?record=<id>` makes 1 (its list), and Back from it
 *   makes 2 (the catalog and the holders of its group's first page);
 * - a cold `/stats/records?view=seasonal` makes **4**: seasons and the three
 *   boards (whose rule line shares the points read), no teams; Historical
 *   from it makes 2 (the catalog and the Top records' holders);
 * - no records request carries `offset`.
 *
 * The Seasons tab's counts (4, and 2 back from a team) are
 * `stats-requests.test.tsx`'s.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  FEATURED_IDS,
  HOLDERS_CAP,
  PAGE_SIZE,
  recordDefinition,
  recordsOf,
} from "../../test/records";
import {
  backButton,
  findCard,
  findCards,
  groupBar,
  loadMore,
  openRecords,
  shownIds,
  tab,
  viewAll,
  viewBar,
} from "../../test/records-screen";
import { server } from "../../test/server";

// The Director's correction (FRONTEND-019): the Records tab is a lazy route,
// and the first test of a file to open it waited on the cold transform of its
// chunk (RecordsTab and the shared navigator), which overran findBy's 1 s
// under the full suite's load. Importing it once here does that work outside
// any test; no assertion changes.
beforeAll(async () => {
  await import("./RecordsTab");
}, 30_000);

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
  // No records read, on any screen of any test here, pages by offset.
  const paged = sent.filter(
    (r) => r.includes("/events/records") && /[?&]offset=/.test(r),
  );
  expect(paged).toEqual([]);
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

const SUMMARY = /^GET \S*\/events\/records$/;
const HOLDERS = /^GET \S*\/events\/records\/holders\?ids=([^&]+)$/;

/** A holders request's ids, checked sorted, distinct and at most 24. */
function holderIds(request: string): string[] {
  const match = HOLDERS.exec(request);
  expect(match, request).not.toBeNull();
  const ids = decodeURIComponent(match?.[1] ?? "").split(",");
  expect(ids).toEqual([...ids].sort());
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.length).toBeLessThanOrEqual(HOLDERS_CAP);
  return ids;
}

function groupIds(group: "team" | "player"): string[] {
  return recordsOf(group).map((record) => record.id);
}

function sorted(ids: readonly string[]): string[] {
  return [...ids].sort();
}

/** A group's first page of cards, as one holders read asks for it. */
function firstPage(group: "team" | "player"): string[] {
  return sorted(groupIds(group).slice(0, PAGE_SIZE));
}

/** Wait until `count` cards are shown. */
async function waitForCount(count: number): Promise<void> {
  await waitFor(() => expect(shownIds()).toHaveLength(count));
}

function listRequest(id: string): RegExp {
  return new RegExp(`^GET \\S*/events/records/${id}\\?limit=100$`);
}

async function listShown(id: string): Promise<void> {
  await screen.findByRole("heading", {
    level: 2,
    name: recordDefinition(id).title,
  });
  await screen.findByRole("table");
}

describe("requests per screen on Records (Baseline c; FRONTEND-030's counts)", () => {
  it("a cold /stats/records makes 2: the catalog, then one holders read for the sixteen", async () => {
    openRecords();
    await findCards("top");

    const requests = await quietAfter(0);
    expect(requests, requests.join("\n")).toHaveLength(2);
    expect(requests[0]).toMatch(SUMMARY);
    expect(holderIds(requests[1])).toEqual(sorted(FEATURED_IDS));
  });

  it("switching to Team and to Player makes 1 each, its first page; back to either, or to Top records, makes 0", async () => {
    openRecords();
    const user = userEvent.setup();
    await findCards("top");
    let mark = (await quietAfter(0)).length;

    await user.click(tab(groupBar(), "Team"));
    await findCards("team");
    let requests = await quietAfter(mark);
    expect(requests, requests.join("\n")).toHaveLength(1);
    expect(holderIds(requests[0])).toEqual(firstPage("team"));
    mark = sent.length;

    await user.click(tab(groupBar(), "Player"));
    await findCards("player");
    requests = await quietAfter(mark);
    expect(requests, requests.join("\n")).toHaveLength(1);
    expect(holderIds(requests[0])).toEqual(firstPage("player"));
    mark = sent.length;

    await user.click(tab(groupBar(), "Team"));
    await findCards("team");
    await user.click(tab(groupBar(), "Top records"));
    await findCards("top");

    requests = await quietAfter(mark);
    expect(requests, requests.join("\n")).toEqual([]);
  });

  it("Load more makes exactly 1, the next 24 ids sorted", async () => {
    openRecords("/stats/records?group=player");
    const user = userEvent.setup();
    await findCards("player");
    const mark = (await quietAfter(0)).length;

    await user.click(loadMore() as HTMLElement);
    await waitForCount(2 * PAGE_SIZE);

    const requests = await quietAfter(mark);
    expect(requests, requests.join("\n")).toHaveLength(1);
    expect(holderIds(requests[0])).toEqual(
      sorted(groupIds("player").slice(PAGE_SIZE, 2 * PAGE_SIZE)),
    );
  });

  it("opening a card makes exactly 1, its list at limit=100; Back makes 0; the same card again makes 0", async () => {
    openRecords("/stats/records?group=player");
    const user = userEvent.setup();
    await findCards("player");
    let mark = (await quietAfter(0)).length;

    const title = recordDefinition("player-points-game").title;
    await user.click(viewAll(await findCard("player", title)));
    await listShown("player-points-game");

    let requests = await quietAfter(mark);
    expect(requests, requests.join("\n")).toHaveLength(1);
    expect(requests[0]).toMatch(listRequest("player-points-game"));
    mark = sent.length;

    await user.click(backButton() as HTMLElement);
    await findCards("player");

    requests = await quietAfter(mark);
    expect(requests, requests.join("\n")).toEqual([]);
    mark = sent.length;

    await user.click(viewAll(await findCard("player", title)));
    await listShown("player-points-game");

    requests = await quietAfter(mark);
    expect(requests, requests.join("\n")).toEqual([]);
  });

  it("a cold /stats/records?record=<id> makes 1, and Back from it makes 2 (the catalog and the holders)", async () => {
    openRecords("/stats/records?record=team-best-season");
    const user = userEvent.setup();
    await listShown("team-best-season");

    let requests = await quietAfter(0);
    expect(requests, requests.join("\n")).toHaveLength(1);
    expect(requests[0]).toMatch(listRequest("team-best-season"));
    const mark = sent.length;

    await user.click(backButton() as HTMLElement);
    await findCards("team");

    requests = await quietAfter(mark);
    expect(requests, requests.join("\n")).toHaveLength(2);
    expect(requests[0]).toMatch(SUMMARY);
    expect(holderIds(requests[1])).toEqual(firstPage("team"));
  });

  it("a cold /stats/records?view=seasonal makes 4 (seasons and the three boards, no teams), and Historical from it makes 2", async () => {
    openRecords("/stats/records?view=seasonal");
    const user = userEvent.setup();
    const leaders = await screen.findByRole("region", { name: "Leaders" });
    await screen.findAllByRole("table");
    expect(leaders).toBeVisible();

    let requests = await quietAfter(0);
    expect(requests, requests.join("\n")).toHaveLength(4);
    expect(requests.filter((r) => /\/events\/seasons$/.test(r))).toHaveLength(
      1,
    );
    expect(requests.filter((r) => /\/leaders\?/.test(r))).toHaveLength(3);
    expect(requests.filter((r) => /\/events\/teams/.test(r))).toEqual([]);
    expect(requests.filter((r) => /\/events\/records/.test(r))).toEqual([]);
    const mark = sent.length;

    await user.click(tab(viewBar(), "Historical"));
    await findCards("top");

    requests = await quietAfter(mark);
    expect(requests, requests.join("\n")).toHaveLength(2);
    expect(requests[0]).toMatch(SUMMARY);
    expect(holderIds(requests[1])).toEqual(sorted(FEATURED_IDS));
  });
});
