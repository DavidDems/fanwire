import { screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";
import type { RequestHandler } from "msw";

import { teamsAre } from "./auth";
import { renderAppAt, type AppRouter } from "./app-route";
import {
  recordHoldersStub,
  recordListStub,
  recordsSummaryStub,
  testRecordsSummary,
  type RecordListOut,
  type RecordsSummaryOut,
} from "./records";
import {
  championStub,
  leadersStub,
  seasonsStub,
  standingsStub,
  statsTeams,
  teamSeasonStub,
  testChampion,
  type Stub,
} from "./stats";

/**
 * The Records tab's screen kit (`FRONTEND-019`): the tab through the real
 * route table, as a guest, with every read it or Seasons may make stubbed and
 * recorded, and the readers its tests share.
 *
 * The bars are found by the tabs they hold ("Historical" / "Seasonal",
 * "Top records" / "Team" / "Player"), not by their names, and a bar's panel by its tabs'
 * `aria-controls`, which is how `SegmentedTabs` ties them (UI-010).
 */

export interface RecordsStubs {
  /** `GET /events/records`, the catalog (`EVENTS-012`). */
  summary: Stub;
  /** `GET /events/records/holders` (`EVENTS-012`), answered from `summary`. */
  holders: Stub;
  list: Stub;
  seasons: Stub;
  leaders: Stub;
  champion: Stub;
  standings: Stub;
  teamSeason: Stub;
}

export interface OpenRecordsOptions {
  /** The screen's data; the catalog and holders stubs both answer from it. */
  summary?: RecordsSummaryOut;
  list?: (id: string) => RecordListOut | null;
  rules?: Record<string, string>;
  /**
   * Installed ahead of the stubs, so they win (a delayed read, say).
   * FRONTEND-030: they were after them, where msw never reached them.
   */
  handlers?: RequestHandler[];
}

export function openRecords(
  path = "/stats/records",
  options: OpenRecordsOptions = {},
) {
  const summary = options.summary ?? testRecordsSummary();
  // holders before list: the list's `:record_id` also matches "holders".
  const stubs: RecordsStubs = {
    summary: recordsSummaryStub(summary),
    holders: recordHoldersStub(summary),
    list: recordListStub(options.list),
    seasons: seasonsStub(),
    leaders: leadersStub(options.rules ?? {}),
    champion: championStub({ "2023-24": testChampion("2023-24") }),
    standings: standingsStub(),
    teamSeason: teamSeasonStub(),
  };
  // msw answers with the first handler that matches, and one `server.use`
  // keeps its list's order, so the test's own handlers go first to win.
  const rendered = renderAppAt(path, "anonymous", [
    ...(options.handlers ?? []),
    teamsAre(statsTeams()),
    ...Object.values(stubs).map((stub) => stub.handler),
  ]);
  return { ...rendered, stubs };
}

export function params(router: AppRouter): URLSearchParams {
  return new URLSearchParams(router.state.location.search);
}

/** The one tablist that holds a tab named `tab`. */
export function tablistHolding(tab: string): HTMLElement {
  const lists = screen
    .queryAllByRole("tablist")
    .filter((list) => within(list).queryByRole("tab", { name: tab }) !== null);
  if (lists.length !== 1)
    throw new Error(
      `expected one tablist with a "${tab}" tab, found ${lists.length}`,
    );
  return lists[0];
}

/** The tablist holding `tab`, or `null` when none is shown. */
export function queryTablistHolding(tab: string): HTMLElement | null {
  return (
    screen
      .queryAllByRole("tablist")
      .find(
        (list) => within(list).queryByRole("tab", { name: tab }) !== null,
      ) ?? null
  );
}

export function tabNames(list: HTMLElement): string[] {
  return within(list)
    .getAllByRole("tab")
    .map((tab) => tab.textContent?.trim() ?? "");
}

export function selectedTab(list: HTMLElement): string {
  const tab = within(list)
    .getAllByRole("tab")
    .find((t) => t.getAttribute("aria-selected") === "true");
  return tab?.textContent?.trim() ?? "";
}

/** The panel a bar switches, through its tabs' `aria-controls`. */
export function panelOf(list: HTMLElement): HTMLElement {
  const id = within(list).getAllByRole("tab")[0].getAttribute("aria-controls");
  const panel = id === null ? null : document.getElementById(id);
  if (panel === null) throw new Error("the bar controls no panel");
  return panel;
}

/** The Historical / Seasonal bar. */
export function viewBar(): HTMLElement {
  return tablistHolding("Historical");
}

/** The Top records / Team / Player bar. */
export function groupBar(): HTMLElement {
  return tablistHolding("Player");
}

export function tab(list: HTMLElement, name: string): HTMLElement {
  return within(list).getByRole("tab", { name });
}

export function crumbs(): HTMLElement[] {
  const nav = screen.getByRole("navigation", { name: "Stats path" });
  const list = nav.querySelector("ol");
  if (list === null) throw new Error("the breadcrumb holds no ordered list");
  return within(list).getAllByRole("listitem");
}

export function crumbTexts(): string[] {
  return crumbs().map((item) =>
    (item.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
}

export function isCurrent(item: HTMLElement): boolean {
  return (
    item.getAttribute("aria-current") === "location" ||
    item.querySelector('[aria-current="location"]') !== null
  );
}

/** A breadcrumb item's control (a link, or a button without an address). */
export function controlIn(item: HTMLElement): HTMLElement {
  const control =
    within(item).queryAllByRole("link")[0] ??
    within(item).queryAllByRole("button")[0];
  if (control === undefined)
    throw new Error("the breadcrumb item is no control");
  return control;
}

export function backButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: /^back\b/i });
}

export function focusedHeading(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  if (active === null || !/^H[1-6]$/.test(active.tagName)) return null;
  return active;
}

/**
 * The records level's bar (`FRONTEND-030`): Top records, Team or Player. Its
 * list of cards is named by it: "Top records", "Team records" or "Player
 * records", with or without a query.
 */
export type RecordsBar = "top" | "team" | "player";

const LIST_NAME = /^(top|team|player) records$/i;

/** The list of cards a bar shows, once it is on screen. */
export async function findCardList(bar: RecordsBar): Promise<HTMLElement> {
  return screen.findByRole("list", {
    name: new RegExp(`^${bar} records$`, "i"),
  });
}

/** The one list of record cards shown, whichever bar it is under, or null. */
export function queryCardList(): HTMLElement | null {
  const lists = screen.queryAllByRole("list", { name: LIST_NAME });
  if (lists.length > 1)
    throw new Error(`expected one list of cards, found ${lists.length}`);
  return lists[0] ?? null;
}

/** A bar's cards: the list items of its list. */
export async function findCards(bar: RecordsBar): Promise<HTMLElement[]> {
  const list = await findCardList(bar);
  return within(list).queryAllByRole("listitem");
}

/** The cards shown now, under any bar (none when no list is shown). */
export function shownCards(): HTMLElement[] {
  const list = queryCardList();
  return list === null ? [] : within(list).queryAllByRole("listitem");
}

/** The record a card opens: the id in its View all link's `?record=`. */
export function cardId(card: HTMLElement): string {
  const href = viewAll(card).getAttribute("href") ?? "";
  return new URL(href, "http://x.test").searchParams.get("record") ?? "";
}

/** The ids of the cards shown, in their order. */
export function shownIds(): string[] {
  return shownCards().map(cardId);
}

/**
 * The card whose h3 is `title` and which opens a record of `group`, in the
 * cards shown (titles repeat across the groups: "Most championships").
 */
export async function findCard(
  group: "team" | "player",
  title: string,
): Promise<HTMLElement> {
  await waitFor(() => expect(queryCardList()).not.toBeNull());
  const card = shownCards().find(
    (item) =>
      within(item).queryByRole("heading", { level: 3, name: title }) !== null &&
      cardId(item).startsWith(`${group}-`),
  );
  if (card === undefined) throw new Error(`no ${group} card titled ${title}`);
  return card;
}

/** The card that opens record `id`, in the cards shown. */
export async function findRecordCard(id: string): Promise<HTMLElement> {
  let found: HTMLElement | undefined;
  await waitFor(() => {
    found = shownCards().find((item) => cardId(item) === id);
    expect(found, `no card for ${id}`).toBeDefined();
  });
  return found as HTMLElement;
}

/** A card's one link, "View all". */
export function viewAll(card: HTMLElement): HTMLElement {
  return within(card).getByRole("link", { name: /view all/i });
}

/** The records search box (`FRONTEND-030`), named by its visible label. */
export function searchBox(): HTMLInputElement {
  return screen.getByRole("searchbox", {
    name: /records/i,
  }) as HTMLInputElement;
}

/** The Load more button under the cards, or null when every match is shown. */
export function loadMore(): HTMLElement | null {
  return screen.queryByRole("button", { name: /load more/i });
}

/** Text that shows a value went missing on the way to the screen. */
export const MISSING = /\bnull\b|\bundefined\b|\bNaN\b/;

/** Whitespace collapsed. */
export function norm(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * What a screen reader reads of `root`'s content (`EVENTS-011`), roughly as
 * the accessible-name walk does it: a subtree marked `aria-hidden="true"` is
 * skipped, an element with an `aria-label` reads as that label instead of
 * its content, and the rest is its text. jsdom applies no styles, so text
 * hidden only visually (a visually-hidden class) is read, as it is in a
 * browser.
 */
export function accessibleText(root: Element): string {
  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof Element)) return "";
    if (node.getAttribute("aria-hidden") === "true") return "";
    const label = node.getAttribute("aria-label");
    if (label !== null && label.trim() !== "" && node !== root)
      return ` ${label} `;
    return Array.from(node.childNodes).map(walk).join("");
  }
  const label = root.getAttribute("aria-label");
  return norm(label !== null && label.trim() !== "" ? label : walk(root));
}

/**
 * The innermost element under `root` whose whole text is `text` (whitespace
 * collapsed): the element that carries a figure's own style.
 */
export function elementWithText(
  root: Element,
  text: string,
): HTMLElement | null {
  const matches = Array.from(root.querySelectorAll<HTMLElement>("*")).filter(
    (element) => norm(element.textContent) === text,
  );
  return (
    matches.find(
      (element) =>
        !matches.some((other) => other !== element && element.contains(other)),
    ) ?? null
  );
}
