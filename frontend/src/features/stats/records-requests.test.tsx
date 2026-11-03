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
 *   holders read covering every team card;
 * - switching Team and Player makes at most 1, a holders read, and switching
 *   back makes 0;
 * - opening a card makes exactly 1, `GET /events/records/<id>?limit=100`;
 * - Back makes 0, and opening the same card again makes 0;
 * - a cold `/stats/records?record=<id>` makes 1 (its list), and Back from it
 *   makes 2 (the catalog and the holders);
 * - a cold `/stats/records?view=seasonal` makes **4**: seasons and the three
 *   boards (whose rule line shares the points read), no teams; Historical
 *   from it makes 2 (the catalog and the holders);
 * - no records request carries `offset`.
 *
 * The Seasons tab's counts (4, and 2 back from a team) are
 * `stats-requests.test.tsx`'s.
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { HOLDERS_CAP, recordDefinition, recordsOf } from "../../test/records";
import {
  backButton,
  findCard,
  findCards,
  groupBar,
  openRecords,
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

describe("requests per screen on Records (Baseline c)", () => {
  it("a cold /stats/records makes 2: the catalog, then one holders read", async () => {
    openRecords();
    await findCards("team");

    const requests = await quietAfter(0);
    expect(requests, requests.join("\n")).toHaveLength(2);
    expect(requests[0]).toMatch(SUMMARY);
    expect(holderIds(requests[1])).toEqual(
      expect.arrayContaining(groupIds("team")),
    );
  });

  it("switching Team and Player makes at most 1, a holders read, and back makes 0", async () => {
    openRecords();
    const user = userEvent.setup();
    await findCards("team");
    const mark = (await quietAfter(0)).length;

    await user.click(tab(groupBar(), "Player"));
    await findCards("player");
    const toPlayer = await quietAfter(mark);
    expect(toPlayer.length, toPlayer.join("\n")).toBeLessThanOrEqual(1);
    const asked = [...holderIds(sent[1]), ...toPlayer.flatMap(holderIds)];
    expect(asked).toEqual(expect.arrayContaining(groupIds("player")));
    const back = sent.length;

    await user.click(tab(groupBar(), "Team"));
    await findCards("team");

    const requests = await quietAfter(back);
    expect(requests, requests.join("\n")).toEqual([]);
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
    holderIds(requests[1]);
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
    await findCards("team");

    requests = await quietAfter(mark);
    expect(requests, requests.join("\n")).toHaveLength(2);
    expect(requests[0]).toMatch(SUMMARY);
    holderIds(requests[1]);
  });
});
