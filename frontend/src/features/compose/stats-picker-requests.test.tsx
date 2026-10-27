/** Baseline (c), through the real route table and the kit's staleTime-0 client. */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderAppAt } from "../../test/app-route";
import {
  attachServer,
  openPicker,
  pickerShown,
  openLebron,
  findPlayerSearch,
  confirmSelection,
  summaryShown,
} from "../../test/attach";
import { server } from "../../test/server";
import { HttpResponse, http } from "msw";
import { testPlayerListItem } from "../../test/stats";

beforeAll(async () => {
  await import("./ComposePage");
  await import("../stats/SeasonsTab");
  await import("../stats/RecordsTab");
}, 30_000);

function arrange(path = "/compose") {
  const events: string[] = [];
  const kit = attachServer();
  const view = renderAppAt(path, "member", kit.handlers);
  function capture({ request }: { request: Request }) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/events/"))
      events.push(url.pathname + url.search);
  }
  server.events.on("request:start", capture);
  return {
    ...view,
    events,
    user: userEvent.setup(),
    stop: () => server.events.removeListener("request:start", capture),
  };
}
async function rootSettled(dialog: HTMLElement) {
  await within(dialog).findByRole("button", { name: /^Toronto Raptors$/ });
}

describe("picker API request counts and private navigation", () => {
  it("Back does not refetch search after its freshness window expires on a player", async () => {
    const flow = arrange();
    const clock = vi.spyOn(Date, "now");
    try {
      await screen.findByRole("textbox", { name: /post/i });
      await openPicker(flow.user);
      const dialog = await pickerShown();
      await rootSettled(dialog);
      await openLebron(flow.user);
      const before = flow.events.length;
      clock.mockReturnValue(Date.now() + 31_000);
      await flow.user.click(within(dialog).getByRole("button", { name: "Back" }));
      expect(await findPlayerSearch()).toHaveValue("James");
      await within(dialog).findByRole("button", { name: /LeBron James/ });
      await waitFor(() => expect(flow.queryClient.isFetching()).toBe(0));
      expect(flow.events).toHaveLength(before);
    } finally {
      clock.mockRestore();
      flow.stop();
    }
  });
  it("Back restores player search text and cached results without another request", async () => {
    const flow = arrange();
    try {
      await screen.findByRole("textbox", { name: /post/i });
      await openPicker(flow.user);
      const dialog = await pickerShown();
      await rootSettled(dialog);
      await openLebron(flow.user);
      const before = flow.events.length;
      await flow.user.click(within(dialog).getByRole("button", { name: "Back" }));
      expect(await findPlayerSearch()).toHaveValue("James");
      await within(dialog).findByRole("button", { name: /LeBron James/ });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(flow.events).toHaveLength(before);
    } finally {
      flow.stop();
    }
  });
  it("compose is silent; picker cold makes exactly three, switching tabs and Back add none, each level adds one, and reopening adds none", async () => {
    const flow = arrange();
    try {
      await screen.findByRole("textbox", { name: /post/i });
      expect(flow.events).toEqual([]);
      await openPicker(flow.user);
      let dialog = await pickerShown();
      await rootSettled(dialog);
      expect(flow.events.slice().sort()).toEqual([
        "/api/events/seasons",
        "/api/events/seasons/2023-24/champion",
        "/api/events/seasons/2023-24/standings",
      ]);
      const address = flow.router.state.location;
      await flow.user.click(
        within(dialog).getByRole("tab", { name: "Players" }),
      );
      expect(flow.events).toHaveLength(3);
      await flow.user.click(
        within(dialog).getByRole("tab", { name: "Seasons" }),
      );
      await rootSettled(dialog);
      expect(flow.events).toHaveLength(3);
      await flow.user.click(
        within(dialog).getByRole("button", { name: /^Toronto Raptors$/ }),
      );
      await within(dialog).findByRole("button", { name: /Jan.*15|15.*Jan/ });
      expect(flow.events).toHaveLength(4);
      expect(flow.events[3]).toBe("/api/events/teams/1/seasons/2023-24");
      await flow.user.click(
        within(dialog).getByRole("button", { name: /Jan.*15|15.*Jan/ }),
      );
      const radio = await within(dialog).findByRole("radio", {
        name: /Final score/,
      });
      expect(flow.events).toHaveLength(5);
      expect(flow.events[4]).toBe("/api/events/games/501");
      await flow.user.click(radio);
      await flow.user.click(
        within(dialog).getByRole("button", { name: "Back" }),
      );
      expect(flow.events).toHaveLength(5);
      expect(flow.router.state.location).toEqual(address);
      await flow.user.click(
        within(dialog).getByRole("button", { name: "Cancel" }),
      );
      expect(flow.events).toHaveLength(5);
      await openPicker(flow.user);
      dialog = await pickerShown();
      await rootSettled(dialog);
      expect(flow.events).toHaveLength(5);
      await flow.user.selectOptions(
        within(await pickerShown()).getByRole("combobox", { name: "Season" }),
        "2022-23",
      );
      await waitFor(() => expect(flow.events).toHaveLength(7));
      await within(dialog).findByRole("heading", { name: "2022-23 season" });
      expect(flow.events.slice(5).sort()).toEqual([
        "/api/events/seasons/2022-23/champion",
        "/api/events/seasons/2022-23/standings",
      ]);
    } finally {
      flow.stop();
    }
  });
  it("a pre-filled address makes exactly one game read before picker open", async () => {
    const flow = arrange("/compose?link=game_final&ref=501");
    try {
      await summaryShown();
      expect(flow.events).toEqual(["/api/events/games/501"]);
    } finally {
      flow.stop();
    }
  });
  it("a settled search makes one request, opening a player one, choosing and Select none", async () => {
    const flow = arrange();
    try {
      await screen.findByRole("textbox", { name: /post/i });
      await openPicker(flow.user);
      const dialog = await pickerShown();
      await rootSettled(dialog);
      await openLebron(flow.user);
      expect(flow.events).toHaveLength(5);
      expect(flow.events[3]).toMatch(/^\/api\/events\/players\?/);
      expect(
        new URL("http://localhost" + flow.events[3]).searchParams.get("q"),
      ).toBe("James");
      expect(flow.events[4]).toBe("/api/events/players/2544");
      await flow.user.click(
        within(dialog).getByRole("radio", { name: /^regular season/i }),
      );
      await confirmSelection(flow.user);
      await summaryShown();
      expect(flow.events).toHaveLength(5);
    } finally {
      flow.stop();
    }
  });
  it("Stats and the picker share season reads with distinct labelled season selects", async () => {
    const flow = arrange("/stats/seasons?season=2023-24");
    try {
      await screen.findByRole("heading", { name: "2023-24 season" });
      await screen.findByRole("button", {
        name: /create a post|compose|new post/i,
      });
      await flow.user.click(
        screen.getByRole("button", { name: "Compose a post" }),
      );
      await screen.findByRole("textbox", { name: /post/i });
      const before = flow.events.length;
      await openPicker(flow.user);
      const dialog = await pickerShown();
      await rootSettled(dialog);
      expect(flow.events).toHaveLength(before);
      const selects = document.querySelectorAll<HTMLSelectElement>("select");
      const seasonSelects = [...selects].filter((select) =>
        [...(select.labels ?? [])].some(
          (label) => label.textContent === "Season",
        ),
      );
      expect(seasonSelects).toHaveLength(2);
      expect(new Set(seasonSelects.map((select) => select.id)).size).toBe(2);
      expect(
        within(dialog).getByRole("combobox", { name: "Season" }),
      ).toBeInTheDocument();
    } finally {
      flow.stop();
    }
  });
  it("a team opened in the picker is reused on Stats within its staleTime", async () => {
    const flow = arrange();
    try {
      await screen.findByRole("textbox", { name: /post/i });
      await openPicker(flow.user);
      const dialog = await pickerShown();
      await rootSettled(dialog);
      await flow.user.click(
        within(dialog).getByRole("button", { name: /^Toronto Raptors$/ }),
      );
      await within(dialog).findByRole("button", { name: /Jan.*15|15.*Jan/ });
      expect(
        flow.events.filter(
          (path) => path === "/api/events/teams/1/seasons/2023-24",
        ),
      ).toHaveLength(1);
      await flow.user.click(
        within(dialog).getByRole("button", { name: "Cancel" }),
      );
      await act(async () => {
        await flow.router.navigate("/stats/seasons?season=2023-24&team=1");
      });
      await screen.findByRole("heading", { name: "Toronto Raptors, 2023-24" });
      expect(
        flow.events.filter(
          (path) => path === "/api/events/teams/1/seasons/2023-24",
        ),
      ).toHaveLength(1);
      await flow.user.click(
        screen.getByRole("button", { name: "Compose a post" }),
      );
      await screen.findByRole("textbox", { name: /post/i });
      await openPicker(flow.user);
      const again = await pickerShown();
      await rootSettled(again);
      await flow.user.click(
        within(again).getByRole("button", { name: /^Toronto Raptors$/ }),
      );
      await within(again).findByRole("button", { name: /Jan.*15|15.*Jan/ });
      expect(
        flow.events.filter(
          (path) => path === "/api/events/teams/1/seasons/2023-24",
        ),
      ).toHaveLength(1);
    } finally {
      flow.stop();
    }
  });
  it("uses shared paging, debounce, minimum length and API order for player search", async () => {
    const flow = arrange();
    const results = Array.from({ length: 21 }, (_, index) =>
      testPlayerListItem({
        id: 100 + index,
        first_name: "James",
        last_name: String(20 - index),
      }),
    );
    server.use(
      http.get("*/events/players", ({ request }) => {
        const query = new URL(request.url).searchParams;
        const offset = Number(query.get("offset"));
        return HttpResponse.json(
          results.slice(offset, offset + Number(query.get("limit"))),
        );
      }),
    );
    try {
      await screen.findByRole("textbox", { name: /post/i });
      await openPicker(flow.user);
      const dialog = await pickerShown();
      await rootSettled(dialog);
      await flow.user.click(
        within(dialog).getByRole("tab", { name: "Players" }),
      );
      const search = await findPlayerSearch();
      await flow.user.type(search, "J");
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(flow.events).toHaveLength(3);
      await flow.user.type(search, "ames");
      await within(dialog).findByRole("button", { name: "James 20" });
      expect(flow.events).toHaveLength(4);
      let names = within(dialog)
        .getAllByRole("button", { name: /^James \d+$/ })
        .map((node) => node.textContent);
      expect(names).toEqual(
        results.slice(0, 20).map((player) => `James ${player.last_name}`),
      );
      await flow.user.click(
        within(dialog).getByRole("button", { name: /load more players/i }),
      );
      await within(dialog).findByRole("button", { name: "James 0" });
      names = within(dialog)
        .getAllByRole("button", { name: /^James \d+$/ })
        .map((node) => node.textContent);
      expect(names).toHaveLength(21);
      expect(flow.events).toHaveLength(5);
      const query = new URL("http://localhost" + flow.events[4]).searchParams;
      expect(query.get("offset")).toBe("20");
      expect(query.get("limit")).toBe("20");
    } finally {
      flow.stop();
    }
  });
});
