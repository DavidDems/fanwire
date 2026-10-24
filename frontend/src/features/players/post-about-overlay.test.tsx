/**
 * FRONTEND-020 — the player page's career "Post about this" links
 * (FRONTEND-017) open the compose modal over the player page, with the same
 * addresses: the page stays mounted underneath, the dialog is titled
 * "Compose" with the career's summary, and Close returns to the player page's
 * own entry with focus back on the link. That the links exist and where they
 * point is `post-about.test.tsx`'s.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderAppAt } from "../../test/app-route";
import { attachServer, summaryShown, textOf } from "../../test/attach";
import {
  composeTarget,
  playerCareerAddress,
  postAboutLinks,
  signedInShown,
} from "../../test/post-about";
import { testPlayerDetail } from "../../test/stats";
import { bodyRows, tableCaptioned } from "../../test/tables";

const LEBRON = testPlayerDetail();

async function openPlayer() {
  const { handlers } = attachServer({ career: LEBRON });
  const app = renderAppAt(`/players/${LEBRON.id}`, "member", handlers);
  const heading = await screen.findByRole("heading", {
    level: 1,
    name: "LeBron James",
  });
  await signedInShown();
  return { app, heading, user: userEvent.setup() };
}

function regularSeasonLink(): HTMLElement {
  const table = tableCaptioned(screen.getByRole("main"), /career/i);
  const row = bodyRows(table).find((candidate) =>
    /regular/i.test(candidate.textContent ?? ""),
  );
  if (row === undefined) throw new Error("no regular-season career row");
  const [link] = postAboutLinks(row);
  if (link === undefined) throw new Error("no Post about link on the row");
  return link;
}

describe("a career row's link opens compose over the player page", () => {
  it("as a dialog titled Compose, the page underneath unchanged", async () => {
    const { app, heading, user } = await openPlayer();

    await user.click(regularSeasonLink());

    const dialog = await screen.findByRole("dialog", { name: "Compose" });
    expect(
      composeTarget(
        `${app.router.state.location.pathname}${app.router.state.location.search}`,
      ),
    ).toEqual(playerCareerAddress(LEBRON.id, "regular"));
    expect(textOf(await summaryShown())).toMatch(/LeBron James/);
    expect(dialog).toContainElement(
      within(dialog).getByRole("textbox", { name: /post/i }),
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "LeBron James" }),
    ).toBe(heading);
  });

  it("Close returns to the player page's own entry, focus on the link", async () => {
    const { app, heading, user } = await openPlayer();
    const originKey = app.router.state.location.key;
    const link = regularSeasonLink();

    await user.click(link);
    const dialog = await screen.findByRole("dialog", { name: "Compose" });
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Compose" })).toBeNull(),
    );
    expect(app.router.state.location.pathname).toBe(`/players/${LEBRON.id}`);
    expect(app.router.state.location.key).toBe(originKey);
    expect(
      screen.getByRole("heading", { level: 1, name: "LeBron James" }),
    ).toBe(heading);
    await waitFor(() => expect(link).toHaveFocus());
  });
});
