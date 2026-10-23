/**
 * FRONTEND-010 — the shared `Dialog` (`components.md` §2: "use the native
 * `<dialog>` … before considering a dependency").
 *
 * A native `<dialog>` opened with `showModal()` gives focus containment, the
 * top layer and Escape for free in a browser. jsdom implements none of it, so
 * `setupTests.ts` carries a shim for `showModal`/`close`; these tests assert
 * what a reader gets — a dialog named by its visible title, open while `open`
 * is set, and the three ways out (the Close button, Escape as the dialog's
 * `cancel` event, a click on the backdrop) each reported once through
 * `onClose` — never the shim itself.
 *
 * A click on the backdrop reaches the `<dialog>` element itself as the event
 * target; a click anywhere inside the content has a descendant as its target
 * and must not close it.
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog } from "./Dialog";

afterEach(() => {
  vi.restoreAllMocks();
});

function renderDialog(open = true) {
  const onClose = vi.fn();
  const result = render(
    <Dialog open={open} onClose={onClose} title="Thread">
      <p>Body of the dialog</p>
      <button type="button">Inside</button>
    </Dialog>,
  );
  return { onClose, ...result };
}

describe("an open Dialog", () => {
  it("is a native <dialog> named by its title", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "Thread" });
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog).toHaveAttribute("open");
  });

  it("shows the title as the dialog's visible heading, tied by aria-labelledby", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "Thread" });
    const heading = within(dialog).getByRole("heading", { name: "Thread" });
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).not.toBeNull();
    expect(document.getElementById(labelledBy ?? "")).toBe(heading);
  });

  it("is opened with showModal()", () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");

    renderDialog();

    expect(showModal).toHaveBeenCalled();
  });

  it("renders its children inside it", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "Thread" });
    expect(within(dialog).getByText("Body of the dialog")).toBeInTheDocument();
  });

  it("moves focus inside itself when it opens", async () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "Thread" });
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
  });

  it("does not report a close just for opening", () => {
    const { onClose } = renderDialog();

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("the ways out of a Dialog", () => {
  it("has a Close button that calls onClose", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    const dialog = screen.getByRole("dialog", { name: "Thread" });
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape (the dialog's cancel event)", () => {
    const { onClose } = renderDialog();

    const dialog = screen.getByRole("dialog", { name: "Thread" });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on a click on the backdrop (the <dialog> itself is the target)", () => {
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByRole("dialog", { name: "Thread" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on a click inside its content", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    const dialog = screen.getByRole("dialog", { name: "Thread" });
    await user.click(within(dialog).getByText("Body of the dialog"));
    await user.click(within(dialog).getByRole("button", { name: "Inside" }));
    await user.click(within(dialog).getByRole("heading", { name: "Thread" }));

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("a closed Dialog", () => {
  it("is not in the accessibility tree when open is false", () => {
    renderDialog(false);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("closes when open turns false", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog open onClose={onClose} title="Thread">
        <p>Body of the dialog</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Thread" })).toBeInTheDocument();

    rerender(
      <Dialog open={false} onClose={onClose} title="Thread">
        <p>Body of the dialog</p>
      </Dialog>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("dialog[open]")).toBeNull();
  });
});

describe("a Dialog under StrictMode", () => {
  /*
   * Added after the implementation, from the browser pass: the dev server
   * renders under <StrictMode>, which runs the open effect, its cleanup and
   * the effect again. A browser queues the `close` event that the cleanup's
   * close() causes, so it arrives after the dialog is open again. The shim in
   * setupTests.ts fires it synchronously, so this test queues it the way a
   * browser does.
   */
  it("stays open, and does not report a close, after the effect re-runs", async () => {
    vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(
      function close(this: HTMLDialogElement) {
        this.removeAttribute("open");
        setTimeout(() => this.dispatchEvent(new Event("close")), 0);
      },
    );
    const onClose = vi.fn();
    render(
      <StrictMode>
        <Dialog open onClose={onClose} title="Thread">
          <p>Body of the dialog</p>
        </Dialog>
      </StrictMode>,
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Thread" })).toHaveAttribute(
      "open",
    );
  });
});

/**
 * FRONTEND-012 — confirms. A confirm ("Report this post?", "Delete this
 * post?", "Deactivate your account?") is this same `Dialog` with
 * `role="alertdialog"`, still named by its title.
 *
 * **One may open inside another** (a Delete chosen inside the thread modal).
 * Escape there is the inner dialog's `cancel`, and it closes only the inner
 * one: React hands a `cancel` to every `onCancel` up its own tree, whatever the
 * DOM did with it, so a nested confirm whose Escape also closed the modal
 * around it is the failure pinned here. The inner dialog closing (its `close`
 * event) is not the outer one closing either.
 */
describe("a Dialog with role alertdialog", () => {
  it("is an alertdialog named by its title", () => {
    render(
      <Dialog
        open
        onClose={vi.fn()}
        title="Delete this post?"
        role="alertdialog"
      >
        <p>It goes from every feed.</p>
      </Dialog>,
    );

    const dialog = screen.getByRole("alertdialog", {
      name: "Delete this post?",
    });
    expect(dialog.tagName).toBe("DIALOG");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a plain dialog when no role is given", () => {
    renderDialog();

    expect(screen.getByRole("dialog", { name: "Thread" })).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("a Dialog opened inside another", () => {
  function renderNested(innerOpen = true) {
    const onOuterClose = vi.fn();
    const onInnerClose = vi.fn();
    const result = render(
      <Dialog open onClose={onOuterClose} title="Thread">
        <p>The thread</p>
        <Dialog
          open={innerOpen}
          onClose={onInnerClose}
          title="Delete this post?"
          role="alertdialog"
        >
          <button type="button">Cancel</button>
        </Dialog>
      </Dialog>,
    );
    return { onOuterClose, onInnerClose, ...result };
  }

  it("Escape on the inner one (its cancel) closes only the inner one", () => {
    const { onOuterClose, onInnerClose } = renderNested();

    fireEvent(
      screen.getByRole("alertdialog", { name: "Delete this post?" }),
      new Event("cancel", { cancelable: true }),
    );

    expect(onInnerClose).toHaveBeenCalledTimes(1);
    expect(onOuterClose).not.toHaveBeenCalled();
  });

  it("the inner one closing does not report the outer one closed", () => {
    const onOuterClose = vi.fn();
    const { rerender } = render(
      <Dialog open onClose={onOuterClose} title="Thread">
        <Dialog
          open
          onClose={vi.fn()}
          title="Delete this post?"
          role="alertdialog"
        >
          <p>Inner</p>
        </Dialog>
      </Dialog>,
    );

    rerender(
      <Dialog open onClose={onOuterClose} title="Thread">
        <Dialog
          open={false}
          onClose={vi.fn()}
          title="Delete this post?"
          role="alertdialog"
        >
          <p>Inner</p>
        </Dialog>
      </Dialog>,
    );

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Thread" })).toHaveAttribute(
      "open",
    );
    expect(onOuterClose).not.toHaveBeenCalled();
  });

  it("Escape on the outer one still closes the outer one", () => {
    const { onOuterClose, onInnerClose } = renderNested(false);

    fireEvent(
      screen.getByRole("dialog", { name: "Thread" }),
      new Event("cancel", { cancelable: true }),
    );

    expect(onOuterClose).toHaveBeenCalledTimes(1);
    expect(onInnerClose).not.toHaveBeenCalled();
  });
});
