import { apiClient } from "../../api/client";
import type { components, paths } from "../../api/schema";

export type HistoryTab = NonNullable<
  NonNullable<paths["/feed/history"]["get"]["parameters"]["query"]>["tab"]
>;
export type HistoryPageBody = components["schemas"]["HistoryPage"];

/** Under the feed root so the existing card toggles patch and roll back history too. */
export function historyKey(tab: HistoryTab) {
  return ["feed", "history", tab] as const;
}

export async function fetchHistoryPage(
  tab: HistoryTab,
  cursor: string | null,
): Promise<HistoryPageBody> {
  const { data, response } = await apiClient.GET("/feed/history", {
    params: { query: { tab, ...(cursor === null ? {} : { cursor }) } },
  });
  if (!response.ok || data === undefined) {
    throw new Error(`GET /feed/history answered ${response.status}`);
  }
  return data;
}
