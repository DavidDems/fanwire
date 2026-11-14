/**
 * FRONTEND-044: the Schedule nav item, through the real route table.
 *
 * - **Where it sits.** One nav, moved by CSS (`FRONTEND-035`): the sidebar
 *   lists Home, Stats, Schedule, Search, Notifications; the phone bar is the
 *   same list without the sidebar-only Search, so it reads Home, Stats,
 *   Schedule, Notifications, then Sign out. Schedule's item is not sidebar-only:
 *   its `<li>` carries the same class as Stats's, and its link the same class
 *   as Stats's, so it gets the bar's and sidebar's cell (and so
 *   `--target-min`, which `sidebar-nav.test.tsx` resolves for the link class).
 * - **What it is.** A link to `/schedule` with the `CalendarIcon`,
 *   `aria-hidden`, and its label "Schedule" in the shared `.visually-hidden`
 *   class, as every other item.
 * - **When it is current.** `aria-current="page"` on `/schedule` (with or
 *   without `?date=`), and on no other nav link there; not current elsewhere.
 * - **The page is public**, like the `/events` reads: an anonymous visitor at
 *   `/schedule` gets the page (h1 "Schedule"), not the sign-in page, and the
 *   document title is set as the other pages set theirs: none sets its own
 *   (`index.html`'s "fanwire" stands), so the page leaves it as it was.
 *
 * Whether the bar fits at 320 px with no overflow is a browser row.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CalendarIcon } from "../components/ui/icons";
import { renderAppAt, type Visitor } from "../test/app-route";
import { drawsIcon, textOf } from "../test/compose-modal";
import { SCHEDULE_NOON, anyScheduleStub } from "../test/schedule";
import styles from "./AppLayout.module.css";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
  vi.setSystemTime(new Date(SCHEDULE_NOON));
});

afterEach(() => {
  vi.useRealTimers();
});

function nav(): HTMLElement {
  return screen.getByRole("navigation", { name: "Primary" });
}

function navLink(name: string): HTMLElement {
  return within(nav()).getByRole("link", { name });
}

async function show(path: string, as: Visitor) {
  const app = renderAppAt(path, as, [anyScheduleStub().handler]);
  if (path.startsWith("/schedule")) {
    await screen.findByRole("heading", { level: 1, name: "Schedule" });
  } else {
    await screen.findByRole("heading", { level: 1, name: "Feed" });
  }
  if (as === "member") {
    await screen.findByRole("button", { name: "Account menu" });
  }
  return app;
}

describe("the Schedule nav item", () => {
  it.each<Visitor>(["anonymous", "member"])(
    "sits after Stats and before Search in the sidebar's links, for a %s visitor",
    async (as) => {
      await show("/", as);

      const links = within(nav()).getAllByRole("link");
      expect(links.map(textOf)).toEqual([
        "Home",
        "Stats",
        "Schedule",
        "Search",
        "Notifications",
      ]);
      expect(navLink("Schedule")).toHaveAttribute("href", "/schedule");
    },
  );

  it("sits after Stats and before Notifications in the phone bar (the items that are not sidebar-only)", async () => {
    await show("/", "member");

    const items = within(nav()).getAllByRole("listitem");
    // Not vacuous: Search is the sidebar-only item.
    expect(
      items
        .filter((item) => item.classList.contains(styles.sidebarOnly))
        .map(textOf),
    ).toEqual(["Search"]);
    expect(
      items
        .filter((item) => !item.classList.contains(styles.sidebarOnly))
        .map(textOf),
    ).toEqual(["Home", "Stats", "Schedule", "Notifications", "Sign out"]);
  });

  it("is laid out as Stats is: the same item and link classes", async () => {
    await show("/", "member");

    const schedule = navLink("Schedule");
    const stats = navLink("Stats");
    // Neither is current at "/", so neither carries NavLink's active class.
    expect(schedule.className).toBe(stats.className);
    expect(schedule.closest("li")?.className).toBe(
      stats.closest("li")?.className,
    );
  });

  it("carries the calendar icon, aria-hidden, and its label in the shared visually-hidden class", async () => {
    await show("/", "member");
    const link = navLink("Schedule");

    expect(drawsIcon(link, CalendarIcon)).toBe(true);
    expect([...link.querySelectorAll(".visually-hidden")].map(textOf)).toEqual([
      "Schedule",
    ]);
    expect(textOf(link)).toBe("Schedule");
  });

  it.each<[string, Visitor]>([
    ["/schedule", "anonymous"],
    ["/schedule", "member"],
    ["/schedule?date=2026-12-25", "member"],
  ])("is the one current nav link at %s (%s)", async (path, as) => {
    await show(path, as);

    const marked = within(nav())
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page")
      .map(textOf);
    expect(marked).toEqual(["Schedule"]);
  });

  it("is not current on the home page", async () => {
    await show("/", "member");

    expect(navLink("Schedule")).not.toHaveAttribute("aria-current");
  });

  it("is followed to the Schedule page", async () => {
    const app = await show("/", "anonymous");

    navLink("Schedule").click();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Schedule" }),
    ).toBeInTheDocument();
    expect(app.router.state.location.pathname).toBe("/schedule");
  });
});

describe("the Schedule page is public", () => {
  it("an anonymous visitor at /schedule gets the page, not the sign-in page", async () => {
    const app = await show("/schedule", "anonymous");

    expect(app.router.state.location.pathname).toBe("/schedule");
    expect(screen.getAllByRole("heading", { level: 1 }).map(textOf)).toEqual([
      "Schedule",
    ]);
    expect(
      screen.queryByRole("heading", { name: /sign\s*-?\s*in/i }),
    ).toBeNull();
  });

  it("leaves the document title as every other page does", async () => {
    const before = document.title;
    await show("/schedule", "anonymous");

    await waitFor(() => expect(document.title).toBe(before));
  });
});
