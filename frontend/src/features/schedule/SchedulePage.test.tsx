/**
 * FRONTEND-044: the Schedule page at `/schedule`, through the real route
 * table (`renderAppAt`), so the route, the address and the detail modal flow
 * are the app's own.
 *
 * The interface this file pins:
 *
 * - **Day cells side by side**, each a `<section>` labelled by its heading
 *   (role region, named by the day): 5 from 78em (1248 px), 3 from 53.75em
 *   (860 px) to below 78em, 1 below 53.75em, chosen in JavaScript through
 *   `matchMedia` (`routes/useMediaQuery`; `stubViewport` stands in for it, as
 *   in `home-rail.test.tsx`). The middle cell is the centre day; the others are
 *   the days before and after it, in order.
 * - **Today is the current date in US Eastern time.** The clock is set per
 *   test; two cases sit where the Eastern date differs from the UTC date, and
 *   run with the process in Asia/Tokyo, so a page that read the local date
 *   fails on every machine, not only in UTC CI.
 * - **The centre is in the address**: no `?date=` is today;
 *   `?date=YYYY-MM-DD` centres that day; a malformed or impossible date is
 *   today. Moving writes `?date=` (returning to today may drop it).
 * - **Moving**: "Previous day" and "Next day" buttons; each visible day's
 *   heading is a button that makes it the centre; a Today button, outside
 *   every heading, only while the centre is not today, returns to it.
 * - **Headings**: "Today", "Yesterday", "Tomorrow", otherwise "Sat 7 Nov"
 *   (short weekday, day, short month).
 * - **Games**: each day's games are the cell's list items, in the route's
 *   order, each the shared compact card RecentGames renders. A final game
 *   shows both scores as Recent Games does, as one link to `/games/<id>`
 *   that opens in the detail modal over the schedule. A scheduled game shows
 *   both teams ("TBD" for an undecided one) and its Eastern start time as
 *   "7:30 PM ET", or "Time TBD"; it is not a link. No team records. A day
 *   with no game reads "No games".
 * - **Data**: one read per season shown (a date from 1 August is the season
 *   starting that year), cached, so moving inside a season asks nothing and
 *   moving into another season asks once. A 404 season is "No games"; any
 *   other failure is one alert (`InlineAlert`) with a Retry.
 * - **Accessibility**: a polite live region, present before a move,
 *   announces the new centre day after it; `aria-current="date"` on today's
 *   heading (or its button) when today is shown, and nowhere otherwise.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import iconStyles from "../../components/ui/TeamIcon.module.css";
import { RecentGames } from "../games/RecentGames";
import { renderAppAt, type AppRouter } from "../../test/app-route";
import { textOf } from "../../test/compose-modal";
import {
  gameDetailStub,
  recentGamesAre,
  testGameDetail,
  testRecentGame,
} from "../../test/games";
import { renderWithProviders } from "../../test/render";
import {
  NOVEMBER_SCHEDULE,
  SCHEDULE_NOON,
  SCHEDULE_SEASON,
  scheduleStub,
  testSchedule,
  type ScheduleStub,
} from "../../test/schedule";
import { stubViewport, type ViewportStub } from "../../test/search";
import { server } from "../../test/server";
import { backgroundOf, openDialog } from "../../test/thread";

/* ------------------------------------------------------------- the setup */

const PHONE = 360;
const MID = 1000;
const WIDE = 1248;

let viewport: ViewportStub | null = null;

function at(px: number): ViewportStub {
  viewport?.restore();
  viewport = stubViewport(px);
  return viewport;
}

function clock(iso: string): void {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

beforeEach(() => {
  clock(SCHEDULE_NOON);
});

afterEach(() => {
  viewport?.restore();
  viewport = null;
  vi.useRealTimers();
});

function main(): HTMLElement {
  return screen.getByRole("main");
}

/** The day cells, in order: the named sections on the page, not in a dialog. */
function cells(): HTMLElement[] {
  return within(main())
    .queryAllByRole("region")
    .filter((cell) => cell.closest("dialog") === null);
}

/** A cell's heading: the first heading inside it. */
function headingOf(cell: HTMLElement): HTMLElement {
  return within(cell).getAllByRole("heading")[0];
}

function names(): string[] {
  return cells().map((cell) => textOf(headingOf(cell)));
}

function centre(): HTMLElement {
  const all = cells();
  return all[Math.floor(all.length / 2)];
}

function centreName(): string {
  return textOf(headingOf(centre()));
}

function cell(name: string): HTMLElement {
  const found = cells().find((each) => textOf(headingOf(each)) === name);
  if (found === undefined)
    throw new Error(`no cell headed ${name}; cells: ${names().join(", ")}`);
  return found;
}

function gamesIn(name: string): HTMLElement[] {
  return within(cell(name)).queryAllByRole("listitem");
}

/** The Today button: a button named "Today" (or "Back to today") outside every heading. */
function todayButton(): HTMLElement | null {
  const found = within(main())
    .queryAllByRole("button", { name: /^((back|go) to )?today$/i })
    .filter(
      (button) =>
        button.closest("h1, h2, h3, h4, h5, h6, [role=heading]") === null &&
        button.closest("dialog") === null,
    );
  if (found.length > 1) throw new Error("more than one Today button");
  return found[0] ?? null;
}

function arrow(name: "Previous day" | "Next day"): HTMLElement {
  return within(main()).getByRole("button", { name });
}

function dateParam(router: AppRouter): string | null {
  return new URLSearchParams(router.state.location.search).get("date");
}

async function open(
  path: string,
  stub: ScheduleStub = scheduleStub(),
  extra: Parameters<typeof renderAppAt>[2] = [],
) {
  const app = renderAppAt(path, "anonymous", [stub.handler, ...extra]);
  await screen.findByRole("heading", { level: 1, name: "Schedule" });
  await waitFor(() => expect(cells().length).toBeGreaterThan(0));
  return { app, stub, user: userEvent.setup() };
}

/** Wait until the requests have settled and the cell's content is shown. */
async function loaded(stub: ScheduleStub): Promise<void> {
  await waitFor(() => expect(stub.requests.length).toBeGreaterThan(0));
  await waitFor(() =>
    expect(
      cells().every(
        (each) =>
          within(each).queryAllByRole("listitem").length > 0 ||
          within(each).queryByText("No games") !== null,
      ),
    ).toBe(true),
  );
}

async function centreIs(name: string): Promise<void> {
  await waitFor(() => expect(centreName()).toBe(name));
}

/* ------------------------------------------------------------- the page */

describe("the page", () => {
  it("has the h1 Schedule and the two arrows, named Previous day and Next day", async () => {
    await open("/schedule");

    expect(screen.getAllByRole("heading", { level: 1 }).map(textOf)).toEqual([
      "Schedule",
    ]);
    expect(arrow("Previous day")).toBeInTheDocument();
    expect(arrow("Next day")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------- cells by width */

describe("the day cells by width", () => {
  it.each([
    [320, 1],
    [360, 1],
    [768, 1],
    [859, 1],
    [860, 3],
    [1247, 3],
    [1248, 5],
    [1440, 5],
  ])("%i px shows %i cell(s), today in the middle", async (px, count) => {
    at(px);
    await open("/schedule");

    await waitFor(() => expect(cells()).toHaveLength(count));
    expect(centreName()).toBe("Today");
  });

  it("5 cells: the centre and two days either side, in order", async () => {
    at(WIDE);
    await open("/schedule");

    await waitFor(() =>
      expect(names()).toEqual([
        "Thu 5 Nov",
        "Yesterday",
        "Today",
        "Tomorrow",
        "Mon 9 Nov",
      ]),
    );
  });

  it("3 cells: yesterday, today, tomorrow", async () => {
    at(MID);
    await open("/schedule");

    await waitFor(() =>
      expect(names()).toEqual(["Yesterday", "Today", "Tomorrow"]),
    );
  });

  it("1 cell: today only", async () => {
    at(PHONE);
    await open("/schedule");

    await waitFor(() => expect(names()).toEqual(["Today"]));
  });

  it("a resize across the breakpoints changes the cells with no reload, centred on the same day", async () => {
    const view = at(PHONE);
    await open("/schedule?date=2026-11-09");
    await waitFor(() => expect(names()).toEqual(["Mon 9 Nov"]));

    view.setWidth(WIDE);
    await waitFor(() =>
      expect(names()).toEqual([
        "Today",
        "Tomorrow",
        "Mon 9 Nov",
        "Tue 10 Nov",
        "Wed 11 Nov",
      ]),
    );
    view.setWidth(MID);
    await waitFor(() =>
      expect(names()).toEqual(["Tomorrow", "Mon 9 Nov", "Tue 10 Nov"]),
    );
  });
});

/* ------------------------------------------------- today is Eastern */

describe("today is the date in US Eastern time", () => {
  let tz: string | undefined;

  beforeEach(() => {
    // Neither Eastern nor UTC, so a page reading the local date fails here.
    tz = process.env.TZ;
    process.env.TZ = "Asia/Tokyo";
  });

  afterEach(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  it("22:30 Eastern on Sat 7 Nov (8 Nov in UTC) is still 7 Nov: today's games are 7 Nov's", async () => {
    clock("2026-11-08T03:30:00Z");
    at(PHONE);
    const { stub } = await open("/schedule");
    await loaded(stub);

    expect(names()).toEqual(["Today"]);
    expect(gamesIn("Today")).toHaveLength(4);
    expect(textOf(gamesIn("Today")[0])).toContain("Time TBD");
    expect(stub.seasons()).toEqual([SCHEDULE_SEASON]);
  });

  it("21:00 Eastern on Fri 6 Nov (7 Nov in UTC) is 6 Nov: today's game is 6 Nov's final", async () => {
    clock("2026-11-07T02:00:00Z");
    at(MID);
    const { stub } = await open("/schedule");
    await loaded(stub);

    expect(names()).toEqual(["Yesterday", "Today", "Tomorrow"]);
    const today = gamesIn("Today");
    expect(today).toHaveLength(1);
    expect(
      new URL(
        within(today[0]).getByRole("link").getAttribute("href") ?? "",
        "http://x.test",
      ).pathname,
    ).toBe("/games/9106");
    // 7 Nov is tomorrow, with its four games.
    expect(gamesIn("Tomorrow")).toHaveLength(4);
  });
});

/* ------------------------------------------------- the centre in the address */

describe("?date= centres the day", () => {
  it("/schedule?date=2026-12-25 centres Fri 25 Dec, with the days either side, and offers Today", async () => {
    at(MID);
    await open("/schedule?date=2026-12-25");

    await waitFor(() =>
      expect(names()).toEqual(["Thu 24 Dec", "Fri 25 Dec", "Sat 26 Dec"]),
    );
    expect(todayButton()).not.toBeNull();
  });

  it.each(["banana", "2026-13-01", "2026-02-30", "2026-11-7", "20261107", ""])(
    "a malformed date (%j) falls back to today",
    async (value) => {
      at(PHONE);
      await open(`/schedule?date=${value}`);

      await waitFor(() => expect(names()).toEqual(["Today"]));
      expect(todayButton()).toBeNull();
    },
  );
});

/* ------------------------------------------------------------- moving */

describe("moving through the days", () => {
  it("Next day moves the centre forward by one, and the address follows", async () => {
    at(PHONE);
    const { app, user } = await open("/schedule");
    expect(dateParam(app.router)).toBeNull();

    await user.click(arrow("Next day"));
    await centreIs("Tomorrow");
    expect(dateParam(app.router)).toBe("2026-11-08");

    await user.click(arrow("Next day"));
    await centreIs("Mon 9 Nov");
    expect(dateParam(app.router)).toBe("2026-11-09");
  });

  it("Previous day moves the centre back by one", async () => {
    at(PHONE);
    const { app, user } = await open("/schedule");

    await user.click(arrow("Previous day"));
    await centreIs("Yesterday");
    expect(dateParam(app.router)).toBe("2026-11-06");

    await user.click(arrow("Previous day"));
    await centreIs("Thu 5 Nov");
    expect(dateParam(app.router)).toBe("2026-11-05");
  });

  it("each visible day's heading is a button named by the day", async () => {
    at(WIDE);
    await open("/schedule");
    await waitFor(() => expect(cells()).toHaveLength(5));

    for (const each of cells()) {
      const heading = headingOf(each);
      const buttons = within(heading).getAllByRole("button");
      expect(buttons, `${textOf(heading)}'s heading`).toHaveLength(1);
      expect(buttons[0]).toHaveAccessibleName(textOf(heading));
    }
  });

  it("a day's heading makes that day the centre", async () => {
    at(WIDE);
    const { app, user } = await open("/schedule");
    await waitFor(() => expect(cells()).toHaveLength(5));

    await user.click(within(headingOf(cell("Mon 9 Nov"))).getByRole("button"));

    await waitFor(() =>
      expect(names()).toEqual([
        "Today",
        "Tomorrow",
        "Mon 9 Nov",
        "Tue 10 Nov",
        "Wed 11 Nov",
      ]),
    );
    expect(dateParam(app.router)).toBe("2026-11-09");

    await user.click(within(headingOf(cell("Today"))).getByRole("button"));
    await waitFor(() =>
      expect(names()).toEqual([
        "Thu 5 Nov",
        "Yesterday",
        "Today",
        "Tomorrow",
        "Mon 9 Nov",
      ]),
    );
  });

  it("the Today button is shown only off today, also while today is still visible, and returns to it", async () => {
    at(WIDE);
    const { app, user } = await open("/schedule");
    await waitFor(() => expect(cells()).toHaveLength(5));
    expect(todayButton()).toBeNull();

    await user.click(arrow("Next day"));
    await centreIs("Tomorrow");
    // Today is the second cell now, and the button is still offered.
    expect(names()[1]).toBe("Today");
    expect(todayButton()).not.toBeNull();

    await user.click(arrow("Next day"));
    await user.click(arrow("Next day"));
    await user.click(todayButton() as HTMLElement);
    await centreIs("Today");
    expect(todayButton()).toBeNull();
    expect([null, "2026-11-07"]).toContain(dateParam(app.router));
  });

  it("a shared link (a direct load of ?date=) keeps the place and offers Today", async () => {
    at(PHONE);
    const { user } = await open("/schedule?date=2026-11-09");

    await centreIs("Mon 9 Nov");
    await user.click(todayButton() as HTMLElement);
    await centreIs("Today");
  });
});

/* ------------------------------------------------------------- the games */

describe("each day's games", () => {
  it("lists each day's games, and 'No games' for a day without one", async () => {
    at(WIDE);
    const { stub } = await open("/schedule");
    await loaded(stub);

    expect(gamesIn("Thu 5 Nov")).toHaveLength(1);
    expect(gamesIn("Yesterday")).toHaveLength(1);
    expect(gamesIn("Today")).toHaveLength(4);
    expect(gamesIn("Tomorrow")).toHaveLength(0);
    expect(within(cell("Tomorrow")).getByText("No games")).toBeInTheDocument();
    expect(gamesIn("Mon 9 Nov")).toHaveLength(1);
    for (const name of ["Thu 5 Nov", "Yesterday", "Today", "Mon 9 Nov"]) {
      expect(within(cell(name)).queryByText("No games")).toBeNull();
    }
  });

  it("keeps the route's order within a day", async () => {
    at(PHONE);
    const { stub } = await open("/schedule");
    await loaded(stub);

    const [tbdTime, final, evening, undecided] = gamesIn("Today");
    expect(textOf(tbdTime)).toContain("Time TBD");
    expect(within(final).getByRole("link")).toHaveAccessibleName(
      /Celtics.*99.*Knicks.*101|Knicks.*101.*Celtics.*99/,
    );
    expect(textOf(evening)).toMatch(/Raptors.*Celtics|Celtics.*Raptors/);
    expect(textOf(undecided)).toContain("Lakers");
  });

  it("a final game shows both teams and scores as Recent Games does, as one link to /games/<id>", async () => {
    at(PHONE);
    const { stub } = await open("/schedule?date=2026-11-06");
    await loaded(stub);

    const [game] = gamesIn("Yesterday");
    const links = within(game).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(
      new URL(links[0].getAttribute("href") ?? "", "http://x.test").pathname,
    ).toBe("/games/9106");
    expect(links[0]).toHaveAccessibleName(
      /Raptors.*117.*Suns.*109|Suns.*109.*Raptors.*117/,
    );
    expect(game.querySelectorAll(`.${iconStyles.icon}`)).toHaveLength(2);
    const text = textOf(game);
    expect(text).not.toMatch(/\bToronto\b|\bPhoenix\b/);
    expect(text).toMatch(/(?<!\d)117(?!\d)/);
    expect(text).toMatch(/(?<!\d)109(?!\d)/);
  });

  it("a scheduled game shows both teams and its Eastern start time with ET, and is not a link", async () => {
    at(PHONE);
    const { stub } = await open("/schedule");
    await loaded(stub);

    const evening = gamesIn("Today")[2];
    const text = textOf(evening);
    expect(text).toContain("Raptors");
    expect(text).toContain("Celtics");
    expect(text).toContain("7:30 PM ET");
    expect(within(evening).queryAllByRole("link")).toEqual([]);
    expect(evening.querySelectorAll(`.${iconStyles.icon}`)).toHaveLength(2);
  });

  it("a late start reads in Eastern too (10:00 PM ET), whatever the process's time zone", async () => {
    const tz = process.env.TZ;
    process.env.TZ = "Asia/Tokyo";
    try {
      at(PHONE);
      const { stub } = await open("/schedule?date=2026-11-09");
      await loaded(stub);

      const [late] = gamesIn("Mon 9 Nov");
      expect(textOf(late)).toContain("10:00 PM ET");
      expect(textOf(late)).toMatch(/Suns.*Knicks|Knicks.*Suns/);
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it("an undecided team reads TBD", async () => {
    at(PHONE);
    const { stub } = await open("/schedule");
    await loaded(stub);

    const undecided = gamesIn("Today")[3];
    const text = textOf(undecided);
    expect(text).toMatch(/\bTBD\b/);
    expect(text).toContain("Lakers");
    expect(text).toContain("7:30 PM ET");
    expect(text).not.toMatch(/null|undefined/i);
    expect(within(undecided).queryAllByRole("link")).toEqual([]);
  });

  it("a game whose time is not set reads Time TBD, and no time", async () => {
    at(PHONE);
    const { stub } = await open("/schedule");
    await loaded(stub);

    const tbdTime = gamesIn("Today")[0];
    const text = textOf(tbdTime);
    expect(text).toContain("Time TBD");
    expect(text).toContain("Knicks");
    expect(text).toContain("Suns");
    expect(text).not.toMatch(/\d{1,2}:\d{2}/);
    expect(within(tbdTime).queryAllByRole("link")).toEqual([]);
  });

  it("shows no team records", async () => {
    at(WIDE);
    const { stub } = await open("/schedule");
    await loaded(stub);

    expect(textOf(main())).not.toMatch(/\(\d+\s*-\s*\d+\)/);
  });

  it("a final game is the card Recent Games renders: the same link and side classes", async () => {
    at(PHONE);
    const { stub } = await open("/schedule?date=2026-11-06");
    await loaded(stub);
    const scheduleLink = within(gamesIn("Yesterday")[0]).getByRole("link");

    // The same teams and score as the schedule's 6 Nov final.
    server.use(recentGamesAre([testRecentGame({ id: 9106 })]));
    const recent = renderWithProviders(<RecentGames />);
    const recentLink = await within(recent.container).findByRole("link");

    expect(scheduleLink.className).not.toBe("");
    expect(scheduleLink.className).toBe(recentLink.className);
    expect([...scheduleLink.children].map((child) => child.className)).toEqual(
      [...recentLink.children].map((child) => child.className),
    );
  });
});

/* ------------------------------------------- a final game opens the modal */

describe("a final game opens in the detail modal over the schedule", () => {
  it("opens /games/<id> in the one dialog, the schedule underneath, and Escape returns to the same days", async () => {
    at(MID);
    const game = testGameDetail({ id: 9106 });
    const { app, stub, user } = await open(
      "/schedule?date=2026-11-06",
      scheduleStub(),
      [gameDetailStub([game]).handler],
    );
    await loaded(stub);
    const heading = screen.getByRole("heading", { level: 1, name: "Schedule" });

    await user.click(within(gamesIn("Yesterday")[0]).getByRole("link"));

    await waitFor(() =>
      expect(app.router.state.location.pathname).toBe("/games/9106"),
    );
    expect(backgroundOf(app.router)).toMatchObject({ pathname: "/schedule" });
    await waitFor(() => expect(openDialog()).not.toBeNull());
    expect(heading.isConnected).toBe(true);

    // jsdom does not turn Escape into the native dialog cancel event.
    fireEvent(
      openDialog() as HTMLDialogElement,
      new Event("cancel", { cancelable: true }),
    );
    await waitFor(() =>
      expect(app.router.state.location.pathname).toBe("/schedule"),
    );
    expect(dateParam(app.router)).toBe("2026-11-06");
    await waitFor(() =>
      expect(names()).toEqual(["Thu 5 Nov", "Yesterday", "Today"]),
    );
  });
});

/* ------------------------------------------------------------- the data */

describe("one read per season, cached", () => {
  it("five days of one season are one read", async () => {
    at(WIDE);
    const { stub } = await open("/schedule");
    await loaded(stub);

    expect(stub.seasons()).toEqual([SCHEDULE_SEASON]);
  });

  it("moving between days of the season makes no new request", async () => {
    at(PHONE);
    const { stub, user } = await open("/schedule");
    await loaded(stub);

    for (let step = 0; step < 3; step += 1) {
      await user.click(arrow("Next day"));
    }
    await centreIs("Tue 10 Nov");
    for (let step = 0; step < 5; step += 1) {
      await user.click(arrow("Previous day"));
    }
    await centreIs("Thu 5 Nov");
    await user.click(todayButton() as HTMLElement);
    await centreIs("Today");
    await loaded(stub);

    expect(stub.seasons()).toEqual([SCHEDULE_SEASON]);
  });

  it.each([
    ["2027-03-01", "2026-27"],
    ["2026-08-01", "2026-27"],
    ["2026-07-31", "2025-26"],
    ["2026-11-07", "2026-27"],
  ])("?date=%s reads season %s", async (date, season) => {
    at(PHONE);
    const stub = scheduleStub((asked) => testSchedule(asked));
    await open(`/schedule?date=${date}`, stub);
    await loaded(stub);

    expect(stub.seasons()).toEqual([season]);
  });

  it("moving into another season reads it once, and moving back reads nothing", async () => {
    at(PHONE);
    const stub = scheduleStub((asked) => testSchedule(asked));
    const { user } = await open("/schedule?date=2026-08-01", stub);
    await loaded(stub);
    expect(stub.seasons()).toEqual(["2026-27"]);

    await user.click(arrow("Previous day"));
    await centreIs("Fri 31 Jul");
    await loaded(stub);
    expect(stub.seasons()).toEqual(["2026-27", "2025-26"]);

    await user.click(arrow("Next day"));
    await centreIs("Sat 1 Aug");
    await user.click(arrow("Previous day"));
    await centreIs("Fri 31 Jul");
    await loaded(stub);
    expect(stub.seasons()).toEqual(["2026-27", "2025-26"]);
  });

  it("five days across two seasons are one read of each", async () => {
    at(WIDE);
    const stub = scheduleStub((asked) => testSchedule(asked));
    await open("/schedule?date=2026-08-01", stub);
    await loaded(stub);

    expect(names()).toEqual([
      "Thu 30 Jul",
      "Fri 31 Jul",
      "Sat 1 Aug",
      "Sun 2 Aug",
      "Mon 3 Aug",
    ]);
    expect([...stub.seasons()].sort()).toEqual(["2025-26", "2026-27"]);
  });
});

describe("a season with no schedule, and a failed read", () => {
  it("a 404 season shows its days as 'No games', not an error", async () => {
    at(WIDE);
    const stub = scheduleStub({});
    await open("/schedule", stub);
    await loaded(stub);

    for (const each of cells()) {
      expect(within(each).getByText("No games")).toBeInTheDocument();
    }
    expect(within(main()).queryAllByRole("alert")).toEqual([]);
    expect(stub.seasons()).toEqual([SCHEDULE_SEASON]);
  });

  it("any other failure is one alert with a Retry, which reads again", async () => {
    at(WIDE);
    const stub = scheduleStub({
      [SCHEDULE_SEASON]: NOVEMBER_SCHEDULE,
    });
    stub.fail();
    const { user } = await open("/schedule", stub);

    await waitFor(() =>
      expect(within(main()).getAllByRole("alert")).toHaveLength(1),
    );
    const failed = stub.requests.length;
    stub.recover();
    await user.click(
      within(main()).getByRole("button", { name: /retry|try again/i }),
    );

    await waitFor(() => expect(gamesIn("Today")).toHaveLength(4));
    expect(stub.requests.length).toBeGreaterThan(failed);
    expect(within(main()).queryAllByRole("alert")).toEqual([]);
  });

  it("two failed seasons on screen are still one alert", async () => {
    at(WIDE);
    const stub = scheduleStub((asked) => testSchedule(asked));
    stub.fail();
    await open("/schedule?date=2026-08-01", stub);

    await waitFor(() => expect(stub.requests.length).toBeGreaterThanOrEqual(2));
    await waitFor(() =>
      expect(within(main()).getAllByRole("alert")).toHaveLength(1),
    );
    expect(
      within(main()).getAllByRole("button", { name: /retry|try again/i }),
    ).toHaveLength(1);
  });
});

/* ------------------------------------------------------- accessibility */

describe("accessibility", () => {
  it("each cell is a section labelled by its heading", async () => {
    at(WIDE);
    await open("/schedule");
    await waitFor(() => expect(cells()).toHaveLength(5));

    for (const each of cells()) {
      const name = textOf(headingOf(each));
      expect(each.tagName).toBe("SECTION");
      expect(within(main()).getByRole("region", { name })).toBe(each);
    }
  });

  it("marks today's heading aria-current=date while today is shown, centred or not", async () => {
    at(WIDE);
    const { user } = await open("/schedule");
    await waitFor(() => expect(cells()).toHaveLength(5));

    const marked = () => [...main().querySelectorAll('[aria-current="date"]')];
    const today = () => headingOf(cell("Today"));
    const onToday = (element: Element) =>
      element === today() || today().contains(element);

    expect(marked()).toHaveLength(1);
    expect(onToday(marked()[0])).toBe(true);

    await user.click(arrow("Next day"));
    await centreIs("Tomorrow");
    expect(marked()).toHaveLength(1);
    expect(onToday(marked()[0])).toBe(true);
  });

  it("marks nothing aria-current=date while today is not shown", async () => {
    at(WIDE);
    await open("/schedule?date=2026-12-25");
    await centreIs("Fri 25 Dec");

    expect(main().querySelectorAll('[aria-current="date"]')).toHaveLength(0);
  });

  it("a polite live region, there before the move, announces the new centre day", async () => {
    at(PHONE);
    const { stub, user } = await open("/schedule");
    await loaded(stub);
    const polite = [
      ...main().querySelectorAll<HTMLElement>(
        '[aria-live="polite"], [role="status"]',
      ),
    ];
    expect(polite.length).toBeGreaterThan(0);

    await user.click(arrow("Next day"));
    await centreIs("Tomorrow");
    await waitFor(() =>
      expect(
        polite.some(
          (region) =>
            region.isConnected && /Tomorrow|\b8 Nov/.test(textOf(region)),
        ),
      ).toBe(true),
    );

    await user.click(arrow("Next day"));
    await centreIs("Mon 9 Nov");
    await waitFor(() =>
      expect(
        polite.some(
          (region) => region.isConnected && /\b9 Nov/.test(textOf(region)),
        ),
      ).toBe(true),
    );
  });
});
