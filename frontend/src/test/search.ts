import { act } from "@testing-library/react";
import { HttpResponse, http, type RequestHandler } from "msw";

import type { components } from "../api/schema";

/**
 * The search unit's network kit (`FRONTEND-007`): fixtures and msw handler
 * factories for the four `search/` endpoints — `GET /search/accounts`,
 * `GET /search/posts`, `GET /search/games` and `GET /search/games/filters`
 * ([[0x07-search]] Routes).
 *
 * Everything is typed against the generated schema, so a fixture that drifts
 * from `backend/openapi.json` is a typecheck failure rather than a suite that
 * passes against a body the backend never sends. A post result is the feed's
 * own `PostView` — build one with `testPostView` from `./feed`, which is why
 * nothing here duplicates it. `GET /events/teams` is `teamsAre()` in `./auth`,
 * and the like endpoints are `likeStub()` in `./feed`.
 *
 * Every stub records the query string of every request it answered, so a test
 * can count requests **per endpoint** and read the parameters each one sent.
 * That is the whole of "loading more of one does not refetch the other": a
 * component that shared one offset, or one query, between the two free-text
 * lists shows up as an extra request on the list nobody asked to page.
 *
 * The free-text stubs answer by `offset` (absent counts as 0), and an offset
 * the test did not provide is a 404 — so a component that asked for the wrong
 * page gets a visible failure rather than a plausible answer. Nothing here
 * mocks `apiClient` or `fetch`.
 */

export type AccountResult = components["schemas"]["AccountResult"];
export type AccountsPageBody = components["schemas"]["AccountsPage"];
export type PostsPageBody = components["schemas"]["PostsPage"];
export type GameOut = components["schemas"]["GameOut"];
export type GamesPageBody = components["schemas"]["GamesPage"];
export type GameFiltersOut = components["schemas"]["GameFiltersOut"];
type PostView = components["schemas"]["PostView"];

export function testAccount(
  overrides: Partial<AccountResult> = {},
): AccountResult {
  return {
    id: 21,
    username: "northside21",
    description: null,
    profile_picture_media_id: null,
    ...overrides,
  };
}

/**
 * A historical game. The team ids are `testTeams()`'s (1 Toronto Raptors "TOR",
 * 2 Phoenix Suns "PHX"), so a row can be checked for both abbreviations.
 */
export function testGame(overrides: Partial<GameOut> = {}): GameOut {
  return {
    id: 501,
    nba_game_id: 22300417,
    game_type: null,
    season: "2023",
    date: "2024-01-15T00:30:00Z",
    home_team_id: 1,
    away_team_id: 2,
    home_score: 117,
    away_score: 109,
    venue: null,
    ...overrides,
  };
}

export function accountsPage(
  items: AccountResult[] = [],
  nextOffset: number | null = null,
): AccountsPageBody {
  return { items, next_offset: nextOffset };
}

export function postsPage(
  items: PostView[] = [],
  nextOffset: number | null = null,
): PostsPageBody {
  return { items, next_offset: nextOffset };
}

export function gamesPage(
  items: GameOut[] = [],
  nextOffset: number | null = null,
): GamesPageBody {
  return { items, next_offset: nextOffset };
}

/** Distinct strings, so an option's text is never also some other option's. */
export const TEST_SEASONS = ["2022", "2023"];
export const TEST_POSITIONS = ["PG", "SG", "SF", "PF", "C"];

export function testGameFilters(
  overrides: Partial<GameFiltersOut> = {},
): GameFiltersOut {
  return { seasons: TEST_SEASONS, positions: TEST_POSITIONS, ...overrides };
}

/** `GET /search/games/filters` → 200. */
export function gameFiltersAre(
  filters: GameFiltersOut = testGameFilters(),
): RequestHandler {
  return http.get("*/search/games/filters", () =>
    HttpResponse.json<GameFiltersOut>(filters),
  );
}

/** The offset a request asked for: absent is the first page, 0. */
export function offsetOf(params: URLSearchParams): number {
  const raw = params.get("offset");
  return raw === null ? 0 : Number(raw);
}

export interface EndpointStub {
  handler: RequestHandler;
  /** The query string of every request answered, in order. */
  readonly requests: URLSearchParams[];
  /** Answer everything from here on with a 500. */
  fail(): void;
  /**
   * Hold every request open until the returned function is called, so a test
   * can see the loading state rather than race it. Always release.
   */
  hold(): () => void;
}

export interface PagedStub<Body> extends EndpointStub {
  /** Replace (or add) the page answered for `offset`. */
  setPage(offset: number, page: Body): void;
}

function endpointStub<Body>(
  path: string,
  answer: (params: URLSearchParams) => Body | null,
): EndpointStub {
  const requests: URLSearchParams[] = [];
  let failing = false;
  let gate: Promise<void> | null = null;

  return {
    handler: http.get(path, async ({ request }) => {
      const params = new URL(request.url).searchParams;
      // Recorded before the gate, so a held request is still observable as sent.
      requests.push(params);
      if (gate !== null) await gate;
      if (failing)
        return HttpResponse.json(
          { detail: "Internal Server Error" },
          { status: 500 },
        );
      const body = answer(params);
      if (body === null)
        return HttpResponse.json({ detail: "Not Found" }, { status: 404 });
      return HttpResponse.json(body as object);
    }),
    requests,
    fail(): void {
      failing = true;
    },
    hold(): () => void {
      let open = (): void => {};
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      return () => {
        open();
        gate = null;
      };
    },
  };
}

function pagedStub<Body>(
  path: string,
  pages: Record<number, Body>,
): PagedStub<Body> {
  const byOffset = new Map<number, Body>(
    Object.entries(pages).map(([offset, page]) => [Number(offset), page]),
  );
  const stub = endpointStub<Body>(
    path,
    (params) => byOffset.get(offsetOf(params)) ?? null,
  );
  return {
    ...stub,
    setPage(offset: number, page: Body): void {
      byOffset.set(offset, page);
    },
  };
}

/** `GET /search/accounts` → the page for the requested offset; 404 for any other. */
export function accountsStub(
  pages: Record<number, AccountsPageBody> = { 0: accountsPage() },
): PagedStub<AccountsPageBody> {
  return pagedStub("*/search/accounts", pages);
}

/** `GET /search/posts` → the page for the requested offset; 404 for any other. */
export function postsStub(
  pages: Record<number, PostsPageBody> = { 0: postsPage() },
): PagedStub<PostsPageBody> {
  return pagedStub("*/search/posts", pages);
}

/**
 * `GET /search/games` → whatever `answer` makes of the request's parameters.
 *
 * A function rather than a fixed page, so a test can answer each combination
 * of filters with a *different* list: a component that filtered the previous
 * results on the client instead of asking again would then show the wrong
 * games, not the right ones by luck.
 */
export function gamesStub(
  answer: (params: URLSearchParams) => GamesPageBody | null = () => gamesPage(),
): EndpointStub {
  return endpointStub("*/search/games", answer);
}

/**
 * FRONTEND-036: a stand-in for `window.matchMedia`, which jsdom does not
 * implement, so a test can say how wide the viewport is and then resize it.
 *
 * The home page's right rail is mounted from 76.0625em through
 * `routes/useMediaQuery`, and that hook must never stub `matchMedia` itself:
 * the stub lives here, installed per test and removed by `restore()`.
 *
 * A query is evaluated against the stubbed width, `1em` being 16 px: each
 * `(min-width: …)` and `(max-width: …)` in it (em, rem or px) must hold, and
 * a query with neither matches nothing. `setWidth` fires `change` on every
 * list whose answer flipped, inside `act`, as a real resize would.
 */
export interface ViewportStub {
  /** Resize to `px` CSS pixels; lists whose answer flips get a `change`. */
  setWidth(px: number): void;
  /** Every query string `matchMedia` was asked, in order. */
  readonly queries: string[];
  /** How many `change` listeners are attached across every list right now. */
  listenerCount(): number;
  /** Put `window.matchMedia` back the way it was (absent, in jsdom). */
  restore(): void;
}

const PX_PER_EM = 16;

function lengthInPx(value: string, unit: string): number {
  const amount = Number(value);
  return unit.toLowerCase() === "px" ? amount : amount * PX_PER_EM;
}

/** Does `query` hold at `width` px? Only min-width and max-width are understood. */
export function queryHolds(query: string, width: number): boolean {
  const bounds = [
    ...query.matchAll(
      /\(\s*(min|max)-width\s*:\s*([\d.]+)\s*(em|rem|px)\s*\)/gi,
    ),
  ];
  if (bounds.length === 0) return false;
  return bounds.every(([, kind, value, unit]) => {
    const px = lengthInPx(value, unit);
    return kind.toLowerCase() === "min" ? width >= px : width <= px;
  });
}

type ChangeListener =
  | ((event: MediaQueryListEvent) => void)
  | { handleEvent(event: MediaQueryListEvent): void };

export function stubViewport(initialWidth: number): ViewportStub {
  let width = initialWidth;
  const queries: string[] = [];
  const lists: {
    media: string;
    last: boolean;
    listeners: Set<ChangeListener>;
    list: MediaQueryList;
  }[] = [];
  const had = Object.getOwnPropertyDescriptor(window, "matchMedia");

  function matchMedia(media: string): MediaQueryList {
    queries.push(media);
    const listeners = new Set<ChangeListener>();
    const entry = {
      media,
      last: queryHolds(media, width),
      listeners,
      list: undefined as unknown as MediaQueryList,
    };
    const list = {
      media,
      get matches(): boolean {
        return queryHolds(media, width);
      },
      onchange: null as ((event: MediaQueryListEvent) => void) | null,
      addEventListener(type: string, listener: ChangeListener | null): void {
        if (type === "change" && listener !== null) listeners.add(listener);
      },
      removeEventListener(type: string, listener: ChangeListener | null): void {
        if (type === "change" && listener !== null) listeners.delete(listener);
      },
      addListener(listener: ChangeListener | null): void {
        if (listener !== null) listeners.add(listener);
      },
      removeListener(listener: ChangeListener | null): void {
        if (listener !== null) listeners.delete(listener);
      },
      dispatchEvent(): boolean {
        return true;
      },
    };
    entry.list = list as unknown as MediaQueryList;
    lists.push(entry);
    return entry.list;
  }

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: matchMedia,
  });

  return {
    queries,
    setWidth(px: number): void {
      act(() => {
        width = px;
        for (const entry of lists) {
          const now = queryHolds(entry.media, width);
          if (now === entry.last) continue;
          entry.last = now;
          const event = {
            matches: now,
            media: entry.media,
          } as unknown as MediaQueryListEvent;
          for (const listener of [...entry.listeners]) {
            if (typeof listener === "function") listener(event);
            else listener.handleEvent(event);
          }
          const onchange = (
            entry.list as unknown as {
              onchange: ((event: MediaQueryListEvent) => void) | null;
            }
          ).onchange;
          onchange?.(event);
        }
      });
    },
    listenerCount(): number {
      return lists.reduce((sum, entry) => sum + entry.listeners.size, 0);
    },
    restore(): void {
      if (had === undefined) {
        delete (window as unknown as Record<string, unknown>).matchMedia;
      } else {
        Object.defineProperty(window, "matchMedia", had);
      }
    },
  };
}
