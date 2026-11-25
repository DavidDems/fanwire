/**
 * FRONTEND-056: Skip to search. From 76.0625em the home page is the feed, then
 * the rail in an `<aside>` after it, so a keyboard reader reached the rail's
 * search box only after every card of the feed's first page (about 150 Tab
 * stops at 1280 px). While the rail is mounted, `HomeView` renders a "Skip to
 * search" link first in `main`, before the feed, with the shell's skip-link
 * look, that moves focus to the rail's box. The rail stays after the feed.
 *
 * - The reader gets to `main` the way the shell offers: Skip to content, then
 *   Enter, then one Tab reaches this link.
 * - Below 76.0625em there is no rail and no link; a resize across 1217 px
 *   mounts and unmounts it without remounting the feed.
 * - The feed stays `.home`'s first child and its `h1` the page's only one.
 *
 * jsdom has no `matchMedia`: `stubViewport` (`test/search.ts`) stands in for
 * it, one per test, restored after.
 */
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderAppAt } from "../test/app-route";
import { feedPage, feedStub, testPostView } from "../test/feed";
import { recentGamesAre } from "../test/games";
import { stubViewport, type ViewportStub } from "../test/search";
import { server } from "../test/server";
import shellStyles from "./AppLayout.module.css";
import homeStyles from "./HomeView.module.css";

const LINK_NAME = "Skip to search";
const BOX_NAME = "Search accounts and posts";
const WIDE = 1280;
const NARROW = 1216;

beforeEach(() => server.use(recentGamesAre([])));

let viewport: ViewportStub | null = null;

function at(width: number): ViewportStub {
  viewport = stubViewport(width);
  return viewport;
}

afterEach(() => {
  viewport?.restore();
  viewport = null;
});

/** The feed with one post, so it holds a control after the link. */
function feedHandlers() {
  const feed = feedStub([
    feedPage(
      [testPostView({ id: 901, text: "Tip-off at the baseline" })],
      null,
    ),
  ]);
  return [feed.handler, recentGamesAre([])];
}

async function feedHeading(): Promise<HTMLElement> {
  return screen.findByRole("heading", { level: 1, name: "Feed" });
}

async function feedReady(): Promise<HTMLElement> {
  const heading = await feedHeading();
  await screen.findByText("Tip-off at the baseline");
  return heading;
}

function rail(): HTMLElement {
  return screen.getByRole("complementary");
}

/** The element carrying `HomeView.module.css`'s `home` class. */
function homeContainer(): HTMLElement {
  const home = document.querySelector<HTMLElement>(`.${homeStyles.home}`);
  expect(home, "the .home container").not.toBeNull();
  return home as HTMLElement;
}

function precedes(a: Node, b: Node): boolean {
  return Boolean(
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

/** Skip to content, then Enter: focus is on `main`, as a reader gets there. */
async function intoMain(user: ReturnType<typeof userEvent.setup>) {
  screen.getByRole("link", { name: "Skip to content" }).focus();
  await user.keyboard("{Enter}");
  expect(document.activeElement).toBe(screen.getByRole("main"));
}

describe("Skip to search", () => {
  it("at 1280 px, the first Tab stop in main is Skip to search, before the feed", async () => {
    const user = userEvent.setup();
    at(WIDE);
    renderAppAt("/", "member", feedHandlers());
    const heading = await feedReady();
    await within(rail()).findByRole("searchbox", { name: BOX_NAME });

    await intoMain(user);
    await user.tab();

    const link = screen.getByRole("link", { name: LINK_NAME });
    expect(document.activeElement).toBe(link);
    expect(screen.getByRole("main")).toContainElement(link);
    expect(rail()).not.toContainElement(link);
    expect(precedes(link, heading), "the link precedes the feed's h1").toBe(
      true,
    );

    await user.tab();
    const focused = document.activeElement as HTMLElement;
    const feed = homeContainer().firstElementChild as HTMLElement;
    expect(feed).toContainElement(focused);
    expect(rail()).not.toContainElement(focused);
  });

  it("Enter on it moves focus to the rail's search box", async () => {
    const user = userEvent.setup();
    at(WIDE);
    renderAppAt("/", "member", feedHandlers());
    await feedReady();
    const box = await within(rail()).findByRole("searchbox", {
      name: BOX_NAME,
    });

    await intoMain(user);
    await user.tab();
    const link = screen.getByRole("link", { name: LINK_NAME });
    expect(document.activeElement).toBe(link);
    expect(link.getAttribute("href")).toBe("#search-bar-q");

    await user.keyboard("{Enter}");

    expect(document.activeElement).toBe(box);
  });

  it("it has the shell's skip-link look", async () => {
    at(WIDE);
    renderAppAt("/", "member", feedHandlers());
    await feedReady();

    const link = await screen.findByRole("link", { name: LINK_NAME });
    expect(link.classList.contains(shellStyles.skipLink)).toBe(true);
  });

  it("below the rail it is not there, and a resize across 1217 px mounts and unmounts it", async () => {
    const stub = at(NARROW);
    renderAppAt("/", "member", feedHandlers());
    const heading = await feedReady();

    expect(screen.queryByRole("link", { name: LINK_NAME })).toBeNull();

    await act(async () => stub.setWidth(1217));
    expect(
      await screen.findByRole("link", { name: LINK_NAME }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Feed" })).toBe(
      heading,
    );

    await act(async () => stub.setWidth(NARROW));
    expect(screen.queryByRole("link", { name: LINK_NAME })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Feed" })).toBe(
      heading,
    );
  });

  it("the feed stays the home container's first child and the page's only h1", async () => {
    at(WIDE);
    renderAppAt("/", "member", feedHandlers());
    const heading = await feedReady();
    await within(rail()).findByRole("searchbox", { name: BOX_NAME });

    const first = homeContainer().firstElementChild as HTMLElement;
    expect(first).toContainElement(heading);
    expect(screen.getAllByRole("heading", { level: 1 })).toEqual([heading]);
  });
});
