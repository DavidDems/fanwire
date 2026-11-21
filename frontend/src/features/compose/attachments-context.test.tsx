/**
 * `useAttachments` across compose contexts: a context is a mediator and a
 * pre-filled address. Summaries belong to the context they were attached in,
 * a new context starts with none, and the pre-filled link is attached once
 * per context (StrictMode's second effect run included).
 *
 * FRONTEND-047 moved the reset out of render-time ref writes (react-hooks 7's
 * `refs` rule); these pin what it must keep.
 */
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";

import { attachServer, textOf } from "../../test/attach";
import { createTestQueryClient } from "../../test/render";
import { server } from "../../test/server";
import { useAttachments, type AddressLink } from "./AttachmentPicker";
import { ComposeMediator } from "./ComposeMediator";
import { describeBareLink } from "./attachmentReads";
import type { DataLink } from "./dataLink";

const CHOSEN: DataLink = { type: "game_final", ref_id: 777 };
const PREFILL: AddressLink = {
  link: { type: "game_final", ref_id: 501 },
  gameId: null,
};

function Probe({
  mediator,
  prefill,
}: {
  mediator: ComposeMediator;
  prefill: AddressLink | null;
}) {
  const attachments = useAttachments(mediator, prefill);
  return (
    <div>
      {attachments.summary}
      <button
        type="button"
        onClick={() => attachments.attach(CHOSEN, "The chosen game's summary")}
      >
        attach
      </button>
    </div>
  );
}

function renderProbe(mediator: ComposeMediator, prefill: AddressLink | null) {
  const client: QueryClient = createTestQueryClient();
  const ui = (current: ComposeMediator) => (
    <StrictMode>
      <QueryClientProvider client={client}>
        <Probe mediator={current} prefill={prefill} />
      </QueryClientProvider>
    </StrictMode>
  );
  const view = render(ui(mediator));
  return {
    user: userEvent.setup(),
    switchTo: (next: ComposeMediator) => view.rerender(ui(next)),
  };
}

function shownSummary(): string | null {
  const section = screen.queryByRole("region", { name: "Attached stats" });
  return section === null ? null : textOf(section);
}

describe("useAttachments across compose contexts", () => {
  it("shows an attached link's summary in its own mediator, and not in a new one", async () => {
    const first = new ComposeMediator();
    const { user, switchTo } = renderProbe(first, null);

    await user.click(screen.getByRole("button", { name: "attach" }));
    expect(shownSummary()).toContain("The chosen game's summary");

    const second = new ComposeMediator();
    switchTo(second);
    expect(shownSummary(), "the new mediator has nothing attached").toBeNull();

    act(() => {
      second.send("attachment", { kind: "link-attached", link: CHOSEN });
    });
    expect(shownSummary()).toContain(describeBareLink(CHOSEN));
    expect(shownSummary()).not.toContain("The chosen game's summary");
  });

  it("attaches the pre-filled link once, then again in a new mediator", async () => {
    server.use(...attachServer().handlers);
    const first = new ComposeMediator();
    const { switchTo } = renderProbe(first, PREFILL);

    await waitFor(() => expect(shownSummary()).toMatch(/\b117\b/));
    expect(first.getDraft().dataLink).toEqual(PREFILL.link);
    act(() => first.undo());
    expect(
      first.getDraft().dataLink,
      "one Undo removes it: it was attached once",
    ).toBeNull();
    expect(first.canUndo()).toBe(false);

    const second = new ComposeMediator();
    switchTo(second);
    await waitFor(() =>
      expect(second.getDraft().dataLink).toEqual(PREFILL.link),
    );
    expect(shownSummary()).toMatch(/\b117\b/);
    act(() => second.undo());
    expect(second.getDraft().dataLink).toBeNull();
    expect(
      first.getDraft().dataLink,
      "the first mediator is left alone",
    ).toBeNull();
  });
});
