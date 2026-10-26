import { screen, within } from "@testing-library/react";
import type { RequestHandler } from "msw";

import { teamsAre } from "./auth";
import { renderAppAt, type AppRouter } from "./app-route";
import {
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
 * "Team" / "Player"), not by their names, and a bar's panel by its tabs'
 * `aria-controls`, which is how `SegmentedTabs` ties them (UI-010).
 */

export interface RecordsStubs {
  summary: Stub;
  list: Stub;
  seasons: Stub;
  leaders: Stub;
  champion: Stub;
  standings: Stub;
  teamSeason: Stub;
}

export interface OpenRecordsOptions {
  summary?: RecordsSummaryOut;
  list?: (id: string) => RecordListOut | null;
  rules?: Record<string, string>;
  /** Installed after the stubs, so they win (a delayed read, say). */
  handlers?: RequestHandler[];
}

export function openRecords(
  path = "/stats/records",
  options: OpenRecordsOptions = {},
) {
  const stubs: RecordsStubs = {
    summary: recordsSummaryStub(options.summary ?? testRecordsSummary()),
    list: recordListStub(options.list),
    seasons: seasonsStub(),
    leaders: leadersStub(options.rules ?? {}),
    champion: championStub({ "2023-24": testChampion("2023-24") }),
    standings: standingsStub(),
    teamSeason: teamSeasonStub(),
  };
  const rendered = renderAppAt(path, "anonymous", [
    teamsAre(statsTeams()),
    ...Object.values(stubs).map((stub) => stub.handler),
    ...(options.handlers ?? []),
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

/** The Team / Player bar. */
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

/** The group's list of cards: a list named by its group ("Team records"). */
export async function findCards(
  group: "team" | "player",
): Promise<HTMLElement[]> {
  const list = await screen.findByRole("list", {
    name: new RegExp(`${group} records`, "i"),
  });
  return within(list).getAllByRole("listitem");
}

/** The card whose h3 is `title`, in the cards shown. */
export async function findCard(
  group: "team" | "player",
  title: string,
): Promise<HTMLElement> {
  const cards = await findCards(group);
  const card = cards.find(
    (item) =>
      within(item).queryByRole("heading", { level: 3, name: title }) !== null,
  );
  if (card === undefined) throw new Error(`no ${group} card titled ${title}`);
  return card;
}

/** A card's one link, "View all". */
export function viewAll(card: HTMLElement): HTMLElement {
  return within(card).getByRole("link", { name: /view all/i });
}

/** Text that shows a value went missing on the way to the screen. */
export const MISSING = /\bnull\b|\bundefined\b|\bNaN\b/;

/** Whitespace collapsed. */
export function norm(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}
