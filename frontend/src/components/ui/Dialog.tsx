import {
  useId,
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";

import { buttonClass } from "./Button";
import styles from "./Dialog.module.css";
import { XIcon } from "./icons";

export interface DialogProps {
  /** Whether the dialog is open. A closed one renders nothing at all. */
  open: boolean;
  /**
   * Called once for each way out the reader takes: the Close button, Escape
   * (the dialog's `cancel` event) or a click on the backdrop. The dialog does
   * not close itself: the caller turns `open` false (or unmounts it), so the
   * state that decides whether it is open stays the caller's.
   */
  onClose: () => void;
  /** The visible heading, which is also the dialog's accessible name. */
  title: string;
  children: ReactNode;
}

/**
 * The shared modal (`components.md` §2: the native `<dialog>` before any
 * dependency).
 *
 * **`showModal()`, not a hand-built overlay.** It is the one call that gives
 * the browser's own focus containment, top layer, inert page and Escape, all of
 * which an overlay of `div`s has to fake and usually fakes partly.
 *
 * **Named by its title**: the heading is the dialog's `aria-labelledby`, so a
 * screen reader announces "Thread, dialog" on the way in.
 *
 * **Three ways out, each reported once.** The Close button; Escape, which the
 * browser reports as `cancel` and which is prevented so that the caller's
 * state, not the element, decides when it closes; and a click on the backdrop,
 * which is a click whose target is the `<dialog>` itself, pressed there too
 * (its padding is zero and the content fills it, so a click on the content
 * always has a descendant as its target; the content, not the dialog, is the
 * scroller, so its scrollbar is not the dialog's either).
 *
 * **Focus returns to whatever opened it.** The element that had focus when the
 * dialog opened is remembered, and focused again when it closes, if it is still
 * on the page.
 */
export function Dialog({ open, ...rest }: DialogProps) {
  return open ? <OpenDialog {...rest} /> : null;
}

function OpenDialog({ onClose, title, children }: Omit<DialogProps, "open">) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Set while this component closes the element itself, so the `close` event
  // that follows is not mistaken for the reader leaving.
  const closingRef = useRef(false);
  // Where the last press began. A drag that starts in the content and ends on
  // the backdrop (selecting text) fires `click` on the dialog, their common
  // ancestor; only a press that began on the dialog itself is a backdrop click.
  const pressTargetRef = useRef<EventTarget | null>(null);

  // A layout effect, so the dialog is open before any child's passive effect
  // runs: a child that moves focus (the reply box) must not have it taken back
  // by the browser's own dialog focusing.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    closingRef.current = false;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    dialog.showModal();
    // The browser focuses the first focusable descendant itself; where it
    // does not (jsdom), the Close button is that descendant.
    if (!dialog.contains(document.activeElement)) closeRef.current?.focus();

    return () => {
      closingRef.current = true;
      dialog.close();
      if (opener !== null && opener.isConnected) opener.focus();
    };
  }, []);

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>): void {
    event.preventDefault();
    onClose();
  }

  function handleClose(): void {
    // A browser may close the element itself after a repeated Escape, despite
    // the prevented `cancel`. The caller still has to hear about it, or its
    // state says open while nothing is on screen.
    if (!closingRef.current) onClose();
  }

  function handleMouseDown(event: MouseEvent<HTMLDialogElement>): void {
    pressTargetRef.current = event.target;
  }

  function handleClick(event: MouseEvent<HTMLDialogElement>): void {
    const pressTarget = pressTargetRef.current;
    pressTargetRef.current = null;
    // No recorded press (a click with no mousedown before it) is judged by its
    // own target alone.
    const pressedBackdrop =
      pressTarget === null || pressTarget === event.currentTarget;
    if (event.target === event.currentTarget && pressedBackdrop) onClose();
  }

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={handleCancel}
      onClose={handleClose}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      <div className={styles.content}>
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {/*
           * A native button styled as the ghost one: `Button` passes no ref,
           * and this one is focused when the browser does not do it.
           */}
          <button
            ref={closeRef}
            type="button"
            className={`${buttonClass("ghost", "md")} ${styles.close}`}
            aria-label="Close"
            onClick={onClose}
          >
            <XIcon />
          </button>
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </dialog>
  );
}
