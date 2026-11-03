import { http, HttpResponse } from "msw";

import type { components } from "../api/schema";

export type HistoryPageBody = components["schemas"]["HistoryPage"];
export type HistoryTab = "posts" | "replies" | "likes" | "reposts";

/** Network kit only: exercises the generated client, never mocks it. */
export function historyStub(
  pages: Partial<Record<HistoryTab, HistoryPageBody[]>> = {},
) {
  const calls: {
    tab: string;
    cursor: string | null;
    authorization: string | null;
  }[] = [];
  let failing = false;
  return {
    calls,
    fail(value = true) {
      failing = value;
    },
    handler: http.get(/\/feed\/history$/, ({ request }) => {
      const url = new URL(request.url);
      const tab = url.searchParams.get("tab") ?? "posts";
      const cursor = url.searchParams.get("cursor");
      calls.push({
        tab,
        cursor,
        authorization: request.headers.get("authorization"),
      });
      if (failing)
        return HttpResponse.json({ detail: "unavailable" }, { status: 500 });
      const choices = pages[tab as HistoryTab] ?? [
        { items: [], next_cursor: null },
      ];
      const index =
        cursor === null
          ? 0
          : choices.findIndex((page) => page.next_cursor === cursor) + 1;
      return HttpResponse.json<HistoryPageBody>(
        choices[index] ?? { items: [], next_cursor: null },
      );
    }),
  };
}
