import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import skeletonStyles from "../../components/ui/Skeleton.module.css";
import iconStyles from "../../components/ui/TeamIcon.module.css";
import { recentGamesAre, testRecentGame } from "../../test/games";
import { createTestQueryClient, renderWithProviders } from "../../test/render";
import { server } from "../../test/server";
import { RecentGames } from "./RecentGames";

/**
 * FRONTEND-037 changed the first test: each card was the two abbreviations
 * and the shared `GameScore`, linked to `/games/<id>`. It is now the compact
 * card: the two short names (no city), each team's overall record in
 * parentheses ("(12-4)"), both scores, no home or away record, and one link
 * to `/games/<id>?season=<the game's season>`. Muting the losing side is a
 * browser check.
 */
describe("Recent games", () => {
  it("preserves API order, shows short names, records and scores, and names each game link", async () => {
    const items = [
      testRecentGame({ id: 99 }),
      testRecentGame({ id: 2, season: "2022-23" }),
    ];
    server.use(recentGamesAre(items));
    renderWithProviders(<RecentGames />);
    expect(
      await screen.findByRole("heading", { level: 2, name: "Recent games" }),
    ).toBeInTheDocument();
    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(2);
    rows.forEach((row, index) => {
      const link = within(row).getByRole("link");
      const href = new URL(link.getAttribute("href") ?? "", "http://x.test");
      expect(href.pathname).toBe(`/games/${items[index].id}`);
      expect(href.searchParams.get("season")).toBe(items[index].season);
      expect(link).toHaveAccessibleName(
        /Raptors.*117.*Suns.*109|Suns.*109.*Raptors.*117/,
      );
      expect(row.querySelectorAll(`.${iconStyles.icon}`)).toHaveLength(2);
      const text = row.textContent ?? "";
      expect(text).toContain("Raptors");
      expect(text).toContain("Suns");
      expect(text).not.toMatch(/\bToronto\b|\bPhoenix\b/);
      expect(text).toMatch(/\(12-4\)/);
      expect(text).toMatch(/\(8-8\)/);
      expect(text).toMatch(/(?<!\d)117(?!\d)/);
      expect(text).toMatch(/(?<!\d)109(?!\d)/);
      expect(text).not.toMatch(/\bhome\b|\baway\b/i);
      expect(text).not.toMatch(/15 Jan|Jan(uary)? 15/);
      expect(within(row).queryAllByRole("link")).toHaveLength(1);
    });
  });

  it("uses shared Skeleton rows while the request is held", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("*/events/games/recent", async () => {
        await held;
        return HttpResponse.json([testRecentGame()]);
      }),
    );
    const view = renderWithProviders(<RecentGames />);
    try {
      expect(
        await screen.findByRole("heading", { level: 2, name: "Recent games" }),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(
          view.container.querySelectorAll(`.${skeletonStyles.bar}`).length,
        ).toBeGreaterThanOrEqual(5),
      );
      expect(screen.queryAllByRole("link")).toEqual([]);
    } finally {
      release();
    }
    expect(await screen.findByRole("link")).toBeInTheDocument();
  });

  it("shows InlineAlert and retries the failed read", async () => {
    let calls = 0;
    server.use(
      http.get("*/events/games/recent", () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ detail: "Unavailable" }, { status: 500 })
          : HttpResponse.json([testRecentGame()]);
      }),
    );
    renderWithProviders(<RecentGames />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByRole("link")).toBeInTheDocument();
    expect(calls).toBe(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hides the whole section after an empty response", async () => {
    const queryClient = createTestQueryClient();
    server.use(recentGamesAre([]));
    const view = renderWithProviders(<RecentGames />, { queryClient });
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(view.container).toBeEmptyDOMElement();
  });

  it("remounting within five minutes uses cache without another read", async () => {
    const queryClient = createTestQueryClient();
    let calls = 0;
    server.use(
      http.get("*/events/games/recent", () => {
        calls += 1;
        return HttpResponse.json([testRecentGame()]);
      }),
    );
    const view = renderWithProviders(<RecentGames />, { queryClient });
    await screen.findByRole("link");
    const query = queryClient
      .getQueryCache()
      .getAll()
      .find((item) => item.state.data !== undefined);
    expect(
      query && "staleTime" in query.options && query.options.staleTime,
    ).toBe(300_000);
    view.unmount();
    renderWithProviders(<RecentGames />, { queryClient });
    await screen.findByRole("link");
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(calls).toBe(1);
  });
});
