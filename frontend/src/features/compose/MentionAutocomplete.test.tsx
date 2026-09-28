/**
 * FRONTEND-004 acceptance criterion 3 — the autocomplete, end to end through
 * the text box.
 *
 * Both controls are rendered against **one** mediator and nothing else connects
 * them: what is typed into the text box reaches the dropdown, and what the
 * dropdown inserts reaches the text box, entirely through the shared draft.
 *
 * The two triggers are deliberately asymmetric — `#` inserts `#GameId<digits>`,
 * which `app.posts.mentions.MentionParser` resolves to an `EventMention`, and
 * `$` inserts `$<ABBREVIATION>`, which the backend does not parse and which is
 * therefore carried in the post text exactly as authored
 * (`wiki/CodeContext/Modules/0x03-posts.md`, `EventMention` → Open decisions).
 * `mentions.test.ts` pins the tokens themselves; this file pins that selecting a
 * suggestion is what produces them.
 *
 * Suggestions are queried by role and accessible name, never by test id. They
 * are ordinary buttons rather than a `role="listbox"` combobox: a button is
 * keyboard-reachable without any `aria-activedescendant` bookkeeping, and a
 * half-implemented ARIA combobox is worse for a screen reader than a list of
 * plainly-labelled buttons.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithAuth, teamsAre } from "../../test/auth";
import { gamesAre, recordRequests, type RequestRecorder } from "../../test/compose";
import { server } from "../../test/server";
import { ComposeMediator } from "./ComposeMediator";
import { ComposeTextBox } from "./ComposeTextBox";
import { MentionAutocomplete } from "./MentionAutocomplete";

let recorder: RequestRecorder | null = null;

afterEach(() => {
  recorder?.stop();
  recorder = null;
});

function renderComposerControls() {
  const mediator = new ComposeMediator();
  recorder = recordRequests();

  renderWithAuth(
    <>
      <ComposeTextBox mediator={mediator} />
      <MentionAutocomplete mediator={mediator} />
    </>,
  );

  return { mediator, user: userEvent.setup(), recorder };
}

function textBox(): HTMLElement {
  return screen.getByRole("textbox", { name: /post/i });
}

describe("the autocomplete asks for nothing until a trigger is typed", () => {
  it("makes no request while ordinary prose is being typed", async () => {
    // No handler for games or teams is installed on purpose: with
    // `onUnhandledRequest: "error"` a stray request is already wrong, and the
    // recorder makes the assertion deterministic rather than relying on how
    // react-query swallows the rejection.
    const { user, recorder: requests } = renderComposerControls();

    await user.type(textBox(), "Raptors win again");

    expect(textBox()).toHaveValue("Raptors win again");
    expect(requests.paths()).toEqual([]);
  });
});

describe("typing # offers games", () => {
  it("lists games from GET /events/games, filtered by the digits typed", async () => {
    server.use(gamesAre());
    const { user } = renderComposerControls();

    await user.type(textBox(), "Raptors win #12");

    expect(await screen.findByRole("button", { name: /123/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /789/ })).toBeNull();
  });

  it("does not ask for teams", async () => {
    server.use(gamesAre());
    const { user, recorder: requests } = renderComposerControls();

    await user.type(textBox(), "Raptors win #12");
    await screen.findByRole("button", { name: /123/ });

    expect(requests.paths().filter((path) => path.endsWith("/events/teams"))).toEqual([]);
  });

  it("inserts the #GameId<id> token the backend parses when a game is chosen", async () => {
    server.use(gamesAre());
    const { user } = renderComposerControls();
    await user.type(textBox(), "Raptors win #12");

    await user.click(await screen.findByRole("button", { name: /123/ }));

    await waitFor(() => expect(textBox()).toHaveValue("Raptors win #GameId123 "));
  });

  it("closes the suggestions once one is chosen", async () => {
    server.use(gamesAre());
    const { user } = renderComposerControls();
    await user.type(textBox(), "Raptors win #12");

    await user.click(await screen.findByRole("button", { name: /123/ }));

    await waitFor(() => expect(screen.queryByRole("button", { name: /123/ })).toBeNull());
  });
});

describe("typing $ offers teams", () => {
  it("lists teams from GET /events/teams, filtered by what was typed", async () => {
    server.use(teamsAre());
    const { user } = renderComposerControls();

    await user.type(textBox(), "Big night for $to");

    expect(await screen.findByRole("button", { name: /toronto raptors/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /phoenix suns/i })).toBeNull();
  });

  it("does not ask for games", async () => {
    server.use(teamsAre());
    const { user, recorder: requests } = renderComposerControls();

    await user.type(textBox(), "Big night for $to");
    await screen.findByRole("button", { name: /toronto raptors/i });

    expect(requests.paths().filter((path) => path.endsWith("/events/games"))).toEqual([]);
  });

  it("inserts the team's abbreviation when a team is chosen", async () => {
    // `$TOR` resolves to no `Game` and so creates no `EventMention`. The
    // backend keeps the post text exactly as authored, which is the whole
    // contract this token has — do not "fix" it into a `#GameId` form.
    server.use(teamsAre());
    const { user } = renderComposerControls();
    await user.type(textBox(), "Big night for $to");

    await user.click(await screen.findByRole("button", { name: /toronto raptors/i }));

    await waitFor(() => expect(textBox()).toHaveValue("Big night for $TOR "));
  });
});
