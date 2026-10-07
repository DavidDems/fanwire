/**
 * UI-006 — the composer in the "single form card" template
 * (`wiki/CodeContext/FrontendUI/layout.md` §3, `components.md` §5 rows for
 * `features/compose/*`).
 *
 * What jsdom can honestly show (`verification.md` §2b, §2c): which shared
 * component each piece renders through, read off the class that component's
 * own module exports. Every class asserted here belongs to a shared module in
 * `src/components/ui/`; that those rules really exist on disk, and that the
 * composer's own module CSS is clean, is `compose-css.test.ts`.
 *
 * The suggestions stay a list of plain buttons inside a named section, not a
 * combobox, and the file input keeps no `accept` attribute — neither is
 * changed here, and the guards below pin the names a user reaches them by.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import buttonStyles from "../../components/ui/Button.module.css";
import cardStyles from "../../components/ui/Card.module.css";
import messageStyles from "../../components/ui/message.module.css";
import { renderWithAuth, teamsAre } from "../../test/auth";
import {
  createPost,
  gamesAre,
  mediaStatuses,
  s3Upload,
  testFile,
  testUpload,
  uploadTicket,
} from "../../test/compose";
import { server } from "../../test/server";
import { ComposeMediator } from "./ComposeMediator";
import { ComposePage } from "./ComposePage";
import { MediaWidget } from "./MediaWidget";
import { QUICK_POST_TEMPLATES } from "./PostTemplate";

const WRONG_TYPE =
  "That file is not an image we can post. Choose a JPEG, PNG or WebP.";
const TOO_LARGE =
  "That image is too large. The largest size this upload allows is 64 bytes.";
const REJECTED =
  "That image did not pass our checks, so it cannot be posted. Choose another one.";
const PREPARING =
  "Preparing this image. It can be attached once it has been checked.";
const READY = "This image is ready to attach.";
const POST_FAILED =
  "We could not post that. Your draft is still here — please try again.";

/** The nearest ancestor of `element` (itself included) carrying `className`. */
function ancestorWithClass(
  element: HTMLElement,
  className: string,
): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current !== null) {
    if (current.classList.contains(className)) return current;
    current = current.parentElement;
  }
  return null;
}

/** The status or alert paragraph that holds `text`, whatever wraps the text. */
function messageHolding(text: string, role: "status" | "alert"): HTMLElement {
  const holder = screen
    .getByText(text)
    .closest<HTMLElement>(`[role="${role}"]`);
  if (holder === null) throw new Error(`"${text}" is not inside a ${role}`);
  return holder;
}

/** The text a reader gets from `element`, ignoring an icon's empty SVG. */
function textOf(element: HTMLElement): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function renderComposer() {
  renderWithAuth(<ComposePage />);
  return userEvent.setup();
}

function textBox(): HTMLElement {
  return screen.getByRole("textbox", { name: /post/i });
}

function renderWidget() {
  renderWithAuth(<MediaWidget mediator={new ComposeMediator()} />);
  return userEvent.setup();
}

function fileInput(): HTMLElement {
  return screen.getByLabelText(/image/i);
}

describe("the compose form card (criterion 1)", () => {
  it("renders the compose form inside a Card", async () => {
    renderComposer();
    await screen.findByRole("heading", { name: /^compose$/i });

    const form = textBox().closest("form");
    expect(form, "the text box sits in a <form>").not.toBeNull();
    expect(
      ancestorWithClass(form as HTMLElement, cardStyles.card),
      "the form sits in a Card",
    ).not.toBeNull();
  });

  it("posts through a primary Button", async () => {
    renderComposer();

    const post = await screen.findByRole("button", { name: /^post$/i });

    expect(post).toHaveClass(buttonStyles.button, buttonStyles.primary);
  });

  it("offers Undo mention as a ghost Button", async () => {
    server.use(gamesAre());
    const user = renderComposer();

    await user.type(textBox(), "Raptors win #12");
    await user.click(await screen.findByRole("button", { name: /123/ }));
    await waitFor(() => {
      expect(textBox()).toHaveValue("Raptors win #GameId123 ");
    });

    const undo = screen.getByRole("button", { name: /^undo mention$/i });
    expect(undo).toHaveClass(buttonStyles.button, buttonStyles.ghost);
  });

  it("offers every quick-post template as a secondary Button", async () => {
    renderComposer();
    await screen.findByRole("heading", { name: /^compose$/i });

    expect(QUICK_POST_TEMPLATES.length).toBeGreaterThan(0);
    for (const template of QUICK_POST_TEMPLATES) {
      const button = screen.getByRole("button", { name: template.name });
      expect(button, template.name).toHaveClass(
        buttonStyles.button,
        buttonStyles.secondary,
      );
    }
  });
});

describe("the mention suggestions keep their names (criterion 2)", () => {
  it("names the game suggestions and keeps each button's label", async () => {
    server.use(gamesAre());
    const user = renderComposer();

    await user.type(textBox(), "#12");

    const section = await screen.findByRole("region", {
      name: "Game suggestions",
    });
    expect(section).toBeInTheDocument();
    expect(
      await screen.findByRole("button", {
        // The date part is left loose: it is formatted in the runner's zone.
        name: /^Game 123 · \d{1,2} \w{3} 2026 · 110–98$/,
      }),
    ).toBeInTheDocument();
  });

  it("names the team suggestions and keeps each button's label", async () => {
    server.use(teamsAre());
    const user = renderComposer();

    await user.type(textBox(), "$TO");

    const section = await screen.findByRole("region", {
      name: "Team suggestions",
    });
    expect(section).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Toronto Raptors (TOR)" }),
    ).toBeInTheDocument();
  });
});

describe("the media widget's messages (criterion 3)", () => {
  it("says the image is preparing through a neutral StatusLine", async () => {
    server.use(
      uploadTicket(),
      s3Upload(),
      mediaStatuses({ statuses: ["uploaded"] }),
    );
    const user = renderWidget();

    await user.upload(fileInput(), testFile());

    await screen.findByText(PREPARING);
    const note = messageHolding(PREPARING, "status");
    expect(note).toHaveClass(messageStyles.message, messageStyles.neutral);
    expect(textOf(note)).toBe(PREPARING);
  });

  it("says the image is ready through a neutral StatusLine", async () => {
    server.use(
      uploadTicket(),
      s3Upload(),
      mediaStatuses({ statuses: ["processed"] }),
    );
    const user = renderWidget();

    await user.upload(fileInput(), testFile());

    await screen.findByText(READY);
    const note = messageHolding(READY, "status");
    expect(note).toHaveClass(messageStyles.message, messageStyles.neutral);
    expect(textOf(note)).toBe(READY);
  });

  it("refuses a wrong type through InlineAlert, with the same words", async () => {
    const user = renderWidget();

    await user.upload(
      fileInput(),
      testFile({ name: "notes.pdf", type: "application/pdf" }),
    );

    await screen.findByText(WRONG_TYPE);
    const alert = messageHolding(WRONG_TYPE, "alert");
    expect(alert).toHaveClass(messageStyles.message, messageStyles.danger);
    expect(textOf(alert)).toBe(WRONG_TYPE);
  });

  it("refuses a too-large file through InlineAlert, with the same words", async () => {
    server.use(
      uploadTicket({ response: testUpload({ max_bytes: 64 }) }),
      s3Upload(),
    );
    const user = renderWidget();

    await user.upload(fileInput(), testFile({ bytes: 128 }));

    await screen.findByText(TOO_LARGE);
    const alert = messageHolding(TOO_LARGE, "alert");
    expect(alert).toHaveClass(messageStyles.message, messageStyles.danger);
    expect(textOf(alert)).toBe(TOO_LARGE);
  });

  it("reports rejected media through InlineAlert, with the same words", async () => {
    server.use(
      uploadTicket(),
      s3Upload(),
      mediaStatuses({ statuses: ["rejected"] }),
    );
    const user = renderWidget();

    await user.upload(fileInput(), testFile());

    await screen.findByText(REJECTED);
    const alert = messageHolding(REJECTED, "alert");
    expect(alert).toHaveClass(messageStyles.message, messageStyles.danger);
    expect(textOf(alert)).toBe(REJECTED);
  });
});

describe("the file input is still described by its error (criterion 3, guard)", () => {
  it("describes the input with the wrong-type message", async () => {
    const user = renderWidget();

    await user.upload(
      fileInput(),
      testFile({ name: "notes.pdf", type: "application/pdf" }),
    );

    await screen.findByText(WRONG_TYPE);
    expect(fileInput()).toHaveAccessibleDescription(WRONG_TYPE);
  });

  it("describes the input with the too-large message", async () => {
    server.use(
      uploadTicket({ response: testUpload({ max_bytes: 64 }) }),
      s3Upload(),
    );
    const user = renderWidget();

    await user.upload(fileInput(), testFile({ bytes: 128 }));

    await screen.findByText(TOO_LARGE);
    expect(fileInput()).toHaveAccessibleDescription(TOO_LARGE);
  });
});

describe("a failed POST /posts (criterion 4)", () => {
  it("reports the failure through InlineAlert and keeps the draft text", async () => {
    server.use(createPost({ status: 500 }));
    const user = renderComposer();

    await user.type(textBox(), "Raptors in 6");
    await user.click(screen.getByRole("button", { name: /^post$/i }));

    await screen.findByText(POST_FAILED);
    const alert = messageHolding(POST_FAILED, "alert");
    expect(alert).toHaveClass(messageStyles.message, messageStyles.danger);
    expect(textOf(alert)).toBe(POST_FAILED);
    expect(textBox()).toHaveValue("Raptors in 6");
  });
});
