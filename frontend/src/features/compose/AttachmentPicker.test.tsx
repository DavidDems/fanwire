/** FRONTEND-021: navigator selections replace FRONTEND-013's panel. */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { components } from "../../api/schema";
import {
  BARNES_LINE_ID,
  attachBarnesLine,
  attachGameResult,
  attachLebronCareer,
  attachServer,
  attachStatsButton,
  attachedSummary,
  findPlayerSearch,
  noPlayoffsCareer,
  openPicker,
  openGame,
  openLebron,
  pickerShown,
  confirmSelection,
  summaryShown,
  textOf,
  type AttachServerOptions,
} from "../../test/attach";
import { renderWithAuth } from "../../test/auth";
import { createPost } from "../../test/compose";
import { server } from "../../test/server";
import { ComposePage } from "./ComposePage";
import { InlineComposer } from "./InlineComposer";
import { Dialog } from "../../components/ui/Dialog";
import { tableProblems } from "../../test/tables";

type CreatePostRequest = components["schemas"]["CreatePostRequest"];
let bodies: CreatePostRequest[] = [];
afterEach(() => {
  bodies = [];
});
function renderComposer(
  route = "/compose",
  options: AttachServerOptions = {},
  nested = false,
) {
  const { handlers, stubs } = attachServer(options);
  server.use(
    ...handlers,
    createPost({ onRequest: (body) => bodies.push(body) }),
  );
  renderWithAuth(
    nested ? (
      <Dialog open title="Compose" onClose={() => {}}>
        <ComposePage />
      </Dialog>
    ) : (
      <ComposePage />
    ),
    { route },
  );
  return { user: userEvent.setup(), stubs };
}
function textBox() {
  return screen.getByRole("textbox", { name: /post/i });
}
function postButton() {
  return screen.getByRole("button", { name: /^post$/i });
}
function undoButton() {
  return screen.getByRole("button", { name: /^undo/i });
}
async function postWithText(
  user: ReturnType<typeof userEvent.setup>,
  text = "What a night",
) {
  await user.type(textBox(), text);
  await user.click(postButton());
  await waitFor(() => expect(bodies).toHaveLength(1));
  return bodies[0];
}

describe("the picker modal", () => {
  it("opens only on request with two tabs and disabled Select, replacing the three panel choices", async () => {
    const { user } = renderComposer();
    expect(screen.queryByRole("dialog", { name: "Attach stats" })).toBeNull();
    expect(attachStatsButton()).toHaveAttribute("aria-haspopup", "dialog");
    expect(attachStatsButton()).not.toHaveAttribute("aria-expanded");
    expect(attachStatsButton()).not.toHaveAttribute("aria-controls");
    await openPicker(user);
    const dialog = await pickerShown();
    expect(dialog.tagName).toBe("DIALOG");
    expect(
      within(dialog).getByRole("tab", { name: "Seasons" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      within(dialog).getByRole("tab", { name: "Players" }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("tab", { name: "Records" })).toBeNull();
    expect(
      within(dialog).getByRole("combobox", { name: "Season" }),
    ).toHaveValue("2023-24");
    expect(
      within(dialog).getByRole("button", { name: "Select" }),
    ).toBeDisabled();
    expect(within(dialog).getByText("Nothing selected")).toBeInTheDocument();
    for (const name of ["Game result", "Player's game", "Player career"])
      expect(within(dialog).queryByRole("button", { name })).toBeNull();
    expect(
      within(dialog).queryByRole("combobox", { name: /team/i }),
    ).toBeNull();
  });
  it.each(["/compose?reply_to=42"])("offers no stats on %s", async (route) => {
    renderComposer(route);
    expect(screen.queryByRole("button", { name: "Attach stats" })).toBeNull();
    expect(textBox()).toBeInTheDocument();
  });
  it("offers stats on a quote repost", () => {
    renderComposer("/compose?repost_of=7");
    expect(attachStatsButton()).toBeInTheDocument();
  });
  it("offers no stats in the inline reply composer", () => {
    renderWithAuth(
      <InlineComposer parentPostId={101} parentUsername="raptorsfan" />,
    );
    expect(
      screen.getByRole("textbox", { name: /your reply/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attach stats" })).toBeNull();
  });
  it("attaches the game's final score only after Select", async () => {
    const { user, stubs } = renderComposer();
    await openPicker(user);
    const dialog = await openGame(user);
    expect(stubs.detail.requests).toEqual([501]);
    const radio = within(dialog).getByRole("radio", { name: /Final score/ });
    await user.click(radio);
    expect(radio).toBeChecked();
    expect(attachedSummary()).toBeNull();
    expect(
      within(dialog)
        .getByText(/^Selected:/)
        .closest('[role="status"], [aria-live="polite"]'),
    ).not.toBeNull();
    expect(
      within(dialog).getByRole("button", { name: "Select" }),
    ).toBeEnabled();
    await confirmSelection(user);
    expect((await postWithText(user)).data_link).toEqual({
      type: "game_final",
      ref_id: 501,
    });
  });
  it("shows both game types together and only played lines, ordered home then away, in labelled radio groups and accessible tables", async () => {
    const { user } = renderComposer();
    await openPicker(user);
    const dialog = await openGame(user);
    const radios = within(dialog).getAllByRole("radio");
    expect(radios[0]).toHaveAccessibleName(/Final score/);
    const names = radios.map(
      (radio) =>
        radio.getAttribute("aria-label") ??
        (radio as HTMLInputElement).labels?.[0]?.textContent ??
        radio.closest("label")?.textContent ??
        "",
    );
    expect(names.join(" ")).toMatch(/Barnes/);
    expect(names.join(" ")).toMatch(/Booker/);
    for (const name of [/Poeltl/, /Damion Lee/, /Rowman/])
      expect(within(dialog).queryByRole("radio", { name })).toBeNull();
    const barnes = within(dialog).getByRole("radio", { name: /Barnes/ });
    const booker = within(dialog).getByRole("radio", { name: /Booker/ });
    expect(
      Boolean(
        barnes.compareDocumentPosition(booker) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    const heading = within(dialog)
      .getAllByRole("heading")
      .filter((node) => node.tagName === "H2")
      .at(-1);
    const group = within(dialog).getByRole("group", {
      name: heading?.textContent ?? "",
    });
    expect(group).toContainElement(barnes);
    for (const table of dialog.querySelectorAll("table"))
      expect(tableProblems(table)).toEqual([]);
    expect(dialog.textContent).not.toMatch(/null|undefined|NaN/);
  });
  it("native radios share one name and support Space and arrow selection", async () => {
    const { user } = renderComposer();
    await openPicker(user);
    const dialog = await openGame(user);
    const radios = within(dialog).getAllByRole("radio");
    expect(
      new Set(radios.map((radio) => (radio as HTMLInputElement).name)).size,
    ).toBe(1);
    expect((radios[0] as HTMLInputElement).name).not.toBe("");
    radios[0].focus();
    await user.keyboard(" ");
    expect(radios[0]).toBeChecked();
    await user.keyboard("{ArrowDown}");
    expect(radios[1]).toBeChecked();
    expect(radios[0]).not.toBeChecked();
  });
  it("an unplayed Final score is plain text with no disabled or selectable radio", async () => {
    const { user } = renderComposer();
    await openPicker(user);
    const dialog = await openGame(user, /Jan.*18|18.*Jan/);
    expect(within(dialog).getByText(/Final score/)).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("radio", { name: /Final score/ }),
    ).toBeNull();
    expect(dialog.querySelector("input:disabled")).toBeNull();
  });
  it("attaches a played line id, never the player's id", async () => {
    const { user } = renderComposer();
    await attachBarnesLine(user);
    expect((await postWithText(user)).data_link).toEqual({
      type: "player_game",
      ref_id: BARNES_LINE_ID,
    });
  });
  it("searches by name and offers the two career scopes", async () => {
    const { user, stubs } = renderComposer();
    await openPicker(user);
    const dialog = await openLebron(user);
    expect(stubs.players.requests.map((r) => r.query.get("q"))).toEqual([
      "James",
    ]);
    expect(stubs.player.requests.map((r) => r.path.player_id)).toEqual([
      "2544",
    ]);
    expect(
      within(dialog).getByRole("radio", { name: /^regular season/i }),
    ).toHaveAccessibleName(/1,?492/);
    expect(
      within(dialog).getByRole("radio", { name: /^playoffs/i }),
    ).toBeInTheDocument();
  });
  it("a zero-game career scope is plain text, never disabled", async () => {
    const { user } = renderComposer("/compose", { career: noPlayoffsCareer() });
    await openPicker(user);
    const dialog = await openLebron(user);
    expect(
      within(dialog).getByRole("radio", { name: /^regular season/i }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Playoffs/)).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("radio", { name: /^playoffs/i }),
    ).toBeNull();
    expect(dialog.querySelector("input:disabled")).toBeNull();
  });
  it("attaches a career's player id and scope", async () => {
    const { user } = renderComposer();
    await attachLebronCareer(user, /^playoffs/i);
    expect((await postWithText(user)).data_link).toEqual({
      type: "player_career",
      ref_id: 2544,
      scope: "playoffs",
    });
  });
  it("keeps one choice across levels; choosing another replaces it", async () => {
    const { user } = renderComposer();
    await openPicker(user);
    const dialog = await openGame(user);
    await user.click(within(dialog).getByRole("radio", { name: /Barnes/ }));
    await user.click(within(dialog).getByRole("button", { name: "Back" }));
    expect(within(dialog).getByText(/^Selected:/)).toHaveTextContent(/Barnes/);
    await user.click(
      within(dialog).getByRole("button", { name: /Jan.*15|15.*Jan/ }),
    );
    expect(within(dialog).getByRole("radio", { name: /Barnes/ })).toBeChecked();
    await user.click(
      within(dialog).getByRole("radio", { name: /Final score/ }),
    );
    expect(
      within(dialog)
        .getAllByRole("radio")
        .filter((radio) => (radio as HTMLInputElement).checked),
    ).toHaveLength(1);
    await confirmSelection(user);
    expect(textOf(await summaryShown())).not.toMatch(/Barnes/);
  });
  it.each(["Cancel", "Escape", "backdrop", "Close"])(
    "%s closes only the nested picker and preserves draft and existing attachment",
    async (method) => {
      const { user } = renderComposer(
        "/compose?link=game_final&ref=501",
        {},
        true,
      );
      await summaryShown();
      await user.type(textBox(), "Keep my draft");
      await openPicker(user);
      const dialog = await openLebron(user);
      await user.click(
        within(dialog).getByRole("radio", { name: /^playoffs/i }),
      );
      if (method === "Escape")
        fireEvent(dialog, new Event("cancel", { cancelable: true }));
      else if (method === "backdrop") {
        fireEvent.mouseDown(dialog);
        fireEvent.click(dialog);
      } else
        await user.click(within(dialog).getByRole("button", { name: method }));
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Attach stats" }),
        ).toBeNull(),
      );
      expect(screen.getByRole("dialog", { name: "Compose" })).toHaveAttribute(
        "open",
      );
      expect(attachStatsButton()).toHaveFocus();
      expect(textBox()).toHaveValue("Keep my draft");
      expect(textOf(await summaryShown())).toMatch(/117/);
      expect(bodies).toEqual([]);
    },
  );
  it("starts afresh on reopening and picking a season resets the stack", async () => {
    const { user } = renderComposer();
    await openPicker(user);
    let dialog = await openGame(user);
    await user.click(within(dialog).getByRole("radio", { name: /Barnes/ }));
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Season" }),
      "2022-23",
    );
    expect(within(dialog).queryByRole("button", { name: "Back" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await openPicker(user);
    dialog = await pickerShown();
    expect(
      within(dialog).getByRole("combobox", { name: "Season" }),
    ).toHaveValue("2023-24");
    expect(
      within(dialog).getByRole("tab", { name: "Seasons" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByRole("tab", { name: "All" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      within(dialog).getByRole("button", { name: "Select" }),
    ).toBeDisabled();
    expect(within(dialog).getByText("Nothing selected")).toBeInTheDocument();
  });
  it("no level contains a page link, including game and player levels", async () => {
    const { user } = renderComposer();
    await openPicker(user);
    const dialog = await pickerShown();
    expect(dialog.querySelectorAll("a[href]")).toHaveLength(0);
    await openGame(user);
    expect(dialog.querySelectorAll("a[href]")).toHaveLength(0);
    await user.click(within(dialog).getByRole("tab", { name: "Players" }));
    expect(dialog.querySelectorAll("a[href]")).toHaveLength(0);
    await user.type(await findPlayerSearch(), "James");
    await user.click(
      await within(dialog).findByRole("button", { name: /LeBron James/ }),
    );
    await within(dialog).findByRole("radio", { name: /^regular season/i });
    expect(dialog.querySelectorAll("a[href]")).toHaveLength(0);
  });
  it("Enter in search and on a radio never posts the draft or closes the composer", async () => {
    const { user } = renderComposer("/compose", {}, true);
    await user.type(textBox(), "Do not publish this");
    await openPicker(user);
    const dialog = await pickerShown();
    await user.click(within(dialog).getByRole("tab", { name: "Players" }));
    const search = await findPlayerSearch();
    await user.type(search, "James{Enter}");
    await user.click(
      await within(dialog).findByRole("button", { name: /LeBron James/ }),
    );
    const radio = await within(dialog).findByRole("radio", {
      name: /^regular season/i,
    });
    radio.focus();
    await user.keyboard(" {Enter}");
    expect(radio).toBeChecked();
    expect(bodies).toEqual([]);
    expect(screen.getByRole("dialog", { name: "Compose" })).toHaveAttribute(
      "open",
    );
    expect(textBox()).toHaveValue("Do not publish this");
    const form = dialog.closest("form");
    expect(form === null || !form.contains(textBox())).toBe(true);
  });
});

describe("the attachment's summary (criterion 5)", () => {
  it("names a game result by its teams, score and date", async () => {
    const { user } = renderComposer();

    await attachGameResult(user);
    const summary = textOf(await summaryShown());

    expect(summary).toMatch(/Raptors|TOR/);
    expect(summary).toMatch(/Suns|PHX/);
    expect(summary).toMatch(/\b117\b/);
    expect(summary).toMatch(/\b109\b/);
    expect(summary).toMatch(/2024/);
  });

  it("names a player's game by player, team, opponent, date and points", async () => {
    const { user } = renderComposer();

    await attachBarnesLine(user);
    const summary = textOf(await summaryShown());

    expect(summary).toMatch(/Barnes/);
    expect(summary).toMatch(/Raptors|TOR/);
    expect(summary).toMatch(/Suns|PHX/);
    expect(summary).toMatch(/2024/);
    expect(summary).toMatch(/\b22\b/);
    expect(summary).toMatch(/pts|points/i);
  });

  it("names a career by player, scope and games played", async () => {
    const { user } = renderComposer();

    await attachLebronCareer(user);
    const summary = textOf(await summaryShown());

    expect(summary).toMatch(/LeBron James/);
    expect(summary).toMatch(/regular season/i);
    expect(summary).toMatch(/1,?492/);
    expect(summary).toMatch(/games|GP/i);
  });

  it("shows nothing before anything is attached", async () => {
    renderComposer();

    await screen.findByRole("textbox", { name: /post/i });
    expect(attachedSummary()).toBeNull();
    expect(screen.queryByRole("button", { name: /^undo/i })).toBeNull();
  });

  it("Remove clears the attachment, and the post goes without one", async () => {
    const { user } = renderComposer();

    await attachGameResult(user);
    const summary = await summaryShown();
    await user.click(within(summary).getByRole("button", { name: /^remove/i }));

    await waitFor(() => expect(attachedSummary()).toBeNull());
    const body = await postWithText(user);
    expect(body.data_link ?? null).toBeNull();
  });

  it("attaching again replaces the link rather than adding a second", async () => {
    const { user } = renderComposer();

    await attachGameResult(user);
    await summaryShown();
    await attachBarnesLine(user);

    await waitFor(() =>
      expect(textOf(attachedSummary() as HTMLElement)).toMatch(/Barnes/),
    );
    expect(
      screen.getAllByRole("region", { name: /^attached stats$/i }),
    ).toHaveLength(1);
    const body = await postWithText(user);
    expect(body.data_link).toEqual({
      type: "player_game",
      ref_id: BARNES_LINE_ID,
    });
  });

  it("Undo restores the attachment from before the last replace, then none", async () => {
    const { user } = renderComposer();

    await attachGameResult(user);
    await summaryShown();
    await attachBarnesLine(user);
    await waitFor(() =>
      expect(textOf(attachedSummary() as HTMLElement)).toMatch(/Barnes/),
    );

    // Undo the replace: back to the game result.
    await user.click(undoButton());
    await waitFor(() => {
      const summary = textOf(attachedSummary() as HTMLElement);
      expect(summary).not.toMatch(/Barnes/);
      expect(summary).toMatch(/\b117\b/);
    });

    // Undo the first attach: back to nothing.
    await user.click(undoButton());
    await waitFor(() => expect(attachedSummary()).toBeNull());

    const body = await postWithText(user);
    expect(body.data_link ?? null).toBeNull();
  });

  it("Undo keeps the text typed before the attach", async () => {
    const { user } = renderComposer();

    await user.type(textBox(), "Called it");
    await attachGameResult(user);
    await summaryShown();
    await user.click(undoButton());

    await waitFor(() => expect(attachedSummary()).toBeNull());
    expect(textBox()).toHaveValue("Called it");
  });

  it("the Undo control is not the removed Undo mention", async () => {
    const { user } = renderComposer();

    await attachGameResult(user);
    await summaryShown();

    expect(screen.queryByRole("button", { name: /undo mention/i })).toBeNull();
    expect(undoButton()).toBeInTheDocument();
  });
});
