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
 * The file input keeps no `accept` attribute, and the guards below pin the
 * names a user reaches it by. Since FRONTEND-013 the `#`/`$` suggestions are
 * gone; the attachment picker's controls are shared `Button`s (it may use
 * `components/ui` primitives only), and Undo is the ghost Button Undo mention
 * was.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import buttonStyles from "../../components/ui/Button.module.css";
import cardStyles from "../../components/ui/Card.module.css";
import messageStyles from "../../components/ui/message.module.css";
import {
  CHOICES,
  attachGameResult,
  attachServer,
  openPicker,
  summaryShown,
} from "../../test/attach";
import { renderWithAuth } from "../../test/auth";
import {
  createPost,
  mediaStatuses,
  s3Upload,
  testFile,
  testUpload,
  uploadTicket,
} from "../../test/compose";
import {
  IMAGE_CHECKING,
  IMAGE_REFUSED,
  IMAGE_UPLOAD_FAILED,
  imageFileInput,
} from "../../test/compose-modal";
import { server } from "../../test/server";
import { ComposeMediator } from "./ComposeMediator";
import { ComposePage } from "./ComposePage";
import { MediaWidget } from "./MediaWidget";
import { QUICK_POST_TEMPLATES } from "./PostTemplate";

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
  return imageFileInput();
}

describe("the compose form card (criterion 1)", () => {
  it("renders the compose form inside a Card", async () => {
    renderComposer();
    await screen.findByRole("textbox", { name: /post/i });

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

  it("offers Attach stats as a shared Button", async () => {
    renderComposer();

    const attach = await screen.findByRole("button", {
      name: /^attach stats$/i,
    });

    expect(attach).toHaveClass(buttonStyles.button);
  });

  it("offers Undo, after an attach, as a ghost Button", async () => {
    server.use(...attachServer().handlers);
    const user = renderComposer();
    await screen.findByRole("textbox", { name: /post/i });

    await attachGameResult(user);
    await summaryShown();

    const undo = screen.getByRole("button", { name: /^undo/i });
    expect(undo).toHaveClass(buttonStyles.button, buttonStyles.ghost);
  });

  it("offers every quick-post template as a secondary Button", async () => {
    renderComposer();
    await screen.findByRole("textbox", { name: /post/i });

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

describe("the attachment picker is built from shared Buttons (FRONTEND-013)", () => {
  it("renders its three choices as Buttons", async () => {
    server.use(...attachServer().handlers);
    const user = renderComposer();
    await screen.findByRole("textbox", { name: /post/i });

    await openPicker(user);

    for (const choice of Object.values(CHOICES)) {
      expect(
        screen.getByRole("button", { name: choice }),
        String(choice),
      ).toHaveClass(buttonStyles.button);
    }
  });

  it("renders Remove in the summary as a Button", async () => {
    server.use(...attachServer().handlers);
    const user = renderComposer();
    await screen.findByRole("textbox", { name: /post/i });

    await attachGameResult(user);
    const summary = await summaryShown();

    expect(
      within(summary).getByRole("button", { name: /^remove/i }),
    ).toHaveClass(buttonStyles.button);
  });
});

// FRONTEND-020 replaced the widget's five messages: the tile says "Checking
// the image…" from the choice until the answer, a processed image attaches by
// itself (no "ready to attach"), and every refusal (a wrong type, a file over
// max_bytes, rejected, or the 30 s bound) is the one line
// "The image you attached is too large or cannot be accepted". Only the
// failure to reach the API or the bucket keeps its words. The hidden input is
// no longer the described control (the paperclip opens it), so the
// "described by its error" guards went with the old messages.
describe("the media widget's messages (FRONTEND-020)", () => {
  it("says the image is being checked in a status line", async () => {
    server.use(
      uploadTicket(),
      s3Upload(),
      mediaStatuses({ statuses: ["uploaded"] }),
    );
    const user = renderWidget();

    await user.upload(fileInput(), testFile());

    await screen.findByText(IMAGE_CHECKING);
    expect(textOf(messageHolding(IMAGE_CHECKING, "status"))).toBe(
      IMAGE_CHECKING,
    );
  });

  it.each([
    [
      "a wrong type",
      () => {},
      () => testFile({ name: "notes.pdf", type: "application/pdf" }),
    ],
    [
      "a file over max_bytes",
      () => {
        server.use(
          uploadTicket({ response: testUpload({ max_bytes: 64 }) }),
          s3Upload(),
        );
      },
      () => testFile({ bytes: 128 }),
    ],
    [
      "rejected media",
      () => {
        server.use(
          uploadTicket(),
          s3Upload(),
          mediaStatuses({ statuses: ["rejected"] }),
        );
      },
      () => testFile(),
    ],
  ] as const)(
    "refuses %s with the one line, as an alert",
    async (_name, arrange, file) => {
      arrange();
      const user = renderWidget();

      await user.upload(fileInput(), file());

      await screen.findByText(IMAGE_REFUSED);
      expect(textOf(messageHolding(IMAGE_REFUSED, "alert"))).toBe(
        IMAGE_REFUSED,
      );
    },
  );

  it("keeps the upload failure as InlineAlert, with the same words", async () => {
    server.use(uploadTicket({ status: 500 }));
    const user = renderWidget();

    await user.upload(fileInput(), testFile());

    await screen.findByText(IMAGE_UPLOAD_FAILED);
    const alert = messageHolding(IMAGE_UPLOAD_FAILED, "alert");
    expect(alert).toHaveClass(messageStyles.message, messageStyles.danger);
    expect(textOf(alert)).toBe(IMAGE_UPLOAD_FAILED);
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
