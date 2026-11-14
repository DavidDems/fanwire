/**
 * FRONTEND-009 criterion 7: the Players tab at `/stats/players`, through the
 * real route table.
 *
 * The interface this file pins:
 *
 * - **The bar** is a searchbox (`<input type="search">`) named "Search
 *   players". It is not a form that waits for Enter: as the user types, it
 *   calls `GET /events/players?q=` with the **trimmed** text, **debounced**
 *   (about 250 ms: nothing is sent 100 ms after the last keystroke, and one
 *   request is sent by 400 ms, for the whole text, never for a prefix of it).
 *   An empty or all-space box sends nothing and shows no results.
 * - **The URL holds q** (`?q=`), so a page opened at `?q=` searches at once
 *   and shows the text in the bar.
 * - **The results** are each a link to `/players/<id>` named by the player's
 *   name, with their position and latest team (`latest_team_abbreviation`)
 *   beside it; a null field is left out, never printed.
 * - **Paging** is `useInfiniteQuery` over offsets, as the search page does,
 *   in the API's default pages of 20 (`limit` 20 or absent). A full page
 *   offers a "Load more players" button, which asks for the next offset.
 * - **No results** is an explicit state naming the search (“No players match
 *   ‘zzz’” or similar: it matches /no players/i and contains the text).
 *
 * The debounce is tested with Vitest's fake timers (`shouldAdvanceTime`, so
 * msw and react-query still run), and only in its own describe block.
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderAppAt } from "../../test/app-route";
import {
  limitOf,
  offsetOf,
  playersStub,
  testPlayerListItem,
  type PlayerListItemOut,
} from "../../test/stats";

const LEBRON = testPlayerListItem();
const HARDEN = testPlayerListItem({
  id: 201935,
  first_name: "James",
  last_name: "Harden",
  position: "G",
  jersey: "1",
  latest_team_abbreviation: "LAC",
});
const BRONNY = testPlayerListItem({
  id: 1642355,
  first_name: "Bronny",
  last_name: "James",
  position: null,
  jersey: null,
  latest_team_abbreviation: null,
});

const SMITHS: PlayerListItemOut[] = Array.from({ length: 25 }, (_, index) =>
  testPlayerListItem({
    id: 5000 + index,
    first_name: `Player${String(index).padStart(2, "0")}`,
    last_name: "Smith",
    position: "C",
    latest_team_abbreviation: "BOS",
  }),
);

function answer(q: string | null): PlayerListItemOut[] {
  if (q === "james" || q === "jam") return [BRONNY, HARDEN, LEBRON];
  if (q === "smith") return SMITHS;
  return [];
}

function openPlayers(path = "/stats/players") {
  const players = playersStub(answer);
  const { router } = renderAppAt(path, "anonymous", [players.handler]);
  return { players, router };
}

function box(): HTMLInputElement {
  return screen.getByRole("searchbox", {
    name: "Search players",
  }) as HTMLInputElement;
}

function qOf(router: { state: { location: { search: string } } }): string {
  return (new URLSearchParams(router.state.location.search).get("q") ?? "").trim();
}

function playerLinks(): HTMLElement[] {
  return within(screen.getByRole("main"))
    .queryAllByRole("link")
    .filter((link) => /^\/players\/\d+$/.test(link.getAttribute("href") ?? ""));
}

function nameOf(player: PlayerListItemOut): string {
  return [player.first_name, player.last_name].filter(Boolean).join(" ");
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("the Players tab without a search", () => {
  it("shows the bar, empty, and asks for nothing", async () => {
    const { players } = openPlayers();

    expect(await screen.findByRole("searchbox", { name: "Search players" })).toHaveValue("");
    await settle();
    expect(players.requests).toHaveLength(0);
    expect(playerLinks()).toEqual([]);
    expect(screen.queryByText(/no players/i)).toBeNull();
  });
});

describe("a search from the URL", () => {
  it("searches ?q= at once and shows it in the bar", async () => {
    const { players } = openPlayers("/stats/players?q=james");

    await waitFor(() => expect(playerLinks()).toHaveLength(3));
    expect(box()).toHaveValue("james");
    expect(players.requests.map((r) => r.query.get("q"))).toEqual(["james"]);
    expect(offsetOf(players.requests[0].query)).toBe(0);
    expect(limitOf(players.requests[0].query, 20)).toBe(20);
  });

  it("lists each player by name, linking to their page, with position and latest team", async () => {
    openPlayers("/stats/players?q=james");

    await waitFor(() => expect(playerLinks()).toHaveLength(3));
    for (const player of [BRONNY, HARDEN, LEBRON]) {
      const link = screen.getByRole("link", { name: new RegExp(nameOf(player)) });
      expect(link).toHaveAttribute("href", `/players/${player.id}`);
    }
    const item = (player: PlayerListItemOut) => {
      const link = screen.getByRole("link", { name: new RegExp(nameOf(player)) });
      const row = link.closest<HTMLElement>("li, tr");
      if (row === null) throw new Error(`${nameOf(player)} is in no row`);
      return row.textContent?.replace(/\s+/g, " ") ?? "";
    };
    expect(item(LEBRON)).toMatch(/\bF\b/);
    expect(item(LEBRON)).toMatch(/\bLAL\b/);
    expect(item(HARDEN)).toMatch(/\bG\b/);
    expect(item(HARDEN)).toMatch(/\bLAC\b/);
    expect(item(BRONNY)).not.toMatch(/null|undefined/);
  });

  it("keeps the API's order", async () => {
    openPlayers("/stats/players?q=james");

    await waitFor(() => expect(playerLinks()).toHaveLength(3));
    expect(playerLinks().map((link) => link.getAttribute("href"))).toEqual(
      [BRONNY, HARDEN, LEBRON].map((p) => `/players/${p.id}`),
    );
  });

  it("names the search in an explicit no-results state", async () => {
    const { players } = openPlayers("/stats/players?q=zzz");

    const empty = await screen.findByText(/no players/i);
    expect(empty.textContent).toContain("zzz");
    expect(playerLinks()).toEqual([]);
    const artwork = empty.parentElement?.querySelector(
      "svg[aria-hidden='true']",
    );
    expect(artwork).not.toBeNull();
    expect(
      artwork?.querySelectorAll(
        "a, button, input, select, textarea, [tabindex]",
      ),
    ).toHaveLength(0);
    expect(players.requests).toHaveLength(1);
  });

  it("shows an alert when the search fails", async () => {
    const players = playersStub(answer);
    players.fail();
    renderAppAt("/stats/players?q=james", "anonymous", [players.handler]);

    expect(await screen.findByRole("alert")).toBeVisible();
  });
});

describe("paging", () => {
  it("offers Load more players after a full page of 20, which asks for the next", async () => {
    const { players } = openPlayers("/stats/players?q=smith");
    const user = userEvent.setup();

    const more = await screen.findByRole("button", { name: "Load more players" });
    expect(playerLinks()).toHaveLength(20);

    await user.click(more);

    await waitFor(() => expect(playerLinks()).toHaveLength(25));
    expect(players.requests.map((r) => offsetOf(r.query))).toEqual([0, 20]);
    expect(players.requests.map((r) => r.query.get("q"))).toEqual([
      "smith",
      "smith",
    ]);
    expect(screen.queryByRole("button", { name: "Load more players" })).toBeNull();
  });

  it("offers no Load more after a short page", async () => {
    openPlayers("/stats/players?q=james");

    await waitFor(() => expect(playerLinks()).toHaveLength(3));
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
  });
});

describe("typing in the bar (debounced, with fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }

  function typist() {
    return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  }

  it("sends one request for the whole text, after a pause, never for a prefix", async () => {
    const { players } = openPlayers();
    const user = typist();
    await screen.findByRole("searchbox", { name: "Search players" });

    await user.type(box(), "jam");
    expect(players.requests).toHaveLength(0);
    await advance(100);
    expect(players.requests, "sent within 100 ms of the last keystroke").toHaveLength(0);

    await advance(300);
    await waitFor(() => expect(players.requests).toHaveLength(1));
    expect(players.requests[0].query.get("q")).toBe("jam");
    await waitFor(() => expect(playerLinks()).toHaveLength(3));

    await advance(1000);
    expect(players.requests).toHaveLength(1);
  });

  it("trims the text it sends, and keeps q in the URL", async () => {
    const { players, router } = openPlayers();
    const user = typist();
    await screen.findByRole("searchbox", { name: "Search players" });

    await user.type(box(), "  james  ");
    await advance(400);

    await waitFor(() => expect(players.requests).toHaveLength(1));
    expect(players.requests[0].query.get("q")).toBe("james");
    await waitFor(() => expect(qOf(router)).toBe("james"));
  });

  it("sends nothing for an all-space box", async () => {
    const { players } = openPlayers();
    const user = typist();
    await screen.findByRole("searchbox", { name: "Search players" });

    await user.type(box(), "   ");
    await advance(1000);

    expect(players.requests).toHaveLength(0);
    expect(screen.queryByText(/no players/i)).toBeNull();
  });

  it("clearing the box drops q and the results, and asks nothing more", async () => {
    const { players, router } = openPlayers("/stats/players?q=james");
    const user = typist();
    await waitFor(() => expect(playerLinks()).toHaveLength(3));

    await user.clear(box());
    await advance(1000);

    await waitFor(() => expect(qOf(router)).toBe(""));
    expect(playerLinks()).toEqual([]);
    expect(players.requests).toHaveLength(1);
  });

  it("a new search replaces the old one's results", async () => {
    const { players, router } = openPlayers("/stats/players?q=james");
    const user = typist();
    await waitFor(() => expect(playerLinks()).toHaveLength(3));

    await user.clear(box());
    await user.type(box(), "smith");
    await advance(400);

    await waitFor(() => expect(playerLinks()).toHaveLength(20));
    expect(players.requests.map((r) => r.query.get("q"))).toEqual([
      "james",
      "smith",
    ]);
    expect(qOf(router)).toBe("smith");
  });
});
