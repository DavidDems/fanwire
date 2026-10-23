import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";

import { buttonClass } from "./Button";
import styles from "./Dialog.module.css";
import { ChevronDownIcon, XIcon } from "./icons";
import { InlineAlert } from "./InlineAlert";

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
  /**
   * A step back inside the dialog (`FRONTEND-011`: the previous detail of a
   * modal flow). When given, a Back button leads the header; when not, there
   * is none. Back is not a way out: the dialog stays open.
   */
  onBack?: () => void;
  /**
   * `"alertdialog"` for a confirm (`FRONTEND-012`): a question that interrupts
   * and needs an answer. It has no Close button: its own Cancel is that, and
   * Escape and the backdrop still report `onClose`. `"dialog"` by default.
   */
  role?: "dialog" | "alertdialog";
  /** The id of the text that says what the dialog is about (a confirm's question). */
  describedBy?: string;
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
 * on the page. The caller keeps one `Dialog` mounted while what it shows
 * changes (a modal flow's details), so the opener is still the first one.
 *
 * **Back, when there is somewhere to step back to** (`onBack`): an icon button
 * before the title. It goes when the caller stops passing `onBack`, and focus
 * that was on it moves to Close rather than out of the dialog.
 *
 * **One may open inside another** (`FRONTEND-012`: a confirm chosen inside the
 * thread modal). The browser puts the inner one on top and reports Escape as
 * *its* `cancel`; React then hands that `cancel` (and the inner `close`) to
 * every `onCancel`/`onClose` up its own tree as well, so each handler acts
 * only on an event whose target is its own element. Without that, Escape in a
 * confirm would also leave the whole modal flow under it.
 */
export function Dialog({ open, ...rest }: DialogProps) {
  return open ? <OpenDialog {...rest} /> : null;
}

function OpenDialog({
  onClose,
  title,
  onBack,
  role = "dialog",
  describedBy,
  children,
}: Omit<DialogProps, "open">) {
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

  // Back removed while it had focus leaves focus on nothing; Close is the
  // control in the same place that is always there.
  const hasBack = onBack !== undefined;
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog === null || hasBack) return;
    if (!dialog.contains(document.activeElement)) closeRef.current?.focus();
  }, [hasBack]);

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>): void {
    // A dialog opened inside this one: its Escape is its own.
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    onClose();
  }

  function handleClose(event: SyntheticEvent<HTMLDialogElement>): void {
    // A browser may close the element itself after a repeated Escape, despite
    // the prevented `cancel`. The caller still has to hear about it, or its
    // state says open while nothing is on screen. A `close` that arrives while
    // the element is open again is stale: StrictMode's setup, cleanup, setup
    // closes and reopens it, and the cleanup's queued event lands after the
    // reopen (when `closingRef` is already reset). A forced close leaves the
    // element closed, so it still gets through.
    // A dialog inside this one closing is not this one closing.
    if (event.target !== event.currentTarget) return;
    if (event.currentTarget.open) return;
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
      role={role === "dialog" ? undefined : role}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      onCancel={handleCancel}
      onClose={handleClose}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      <div className={styles.content}>
        <header
          className={`${styles.header} ${hasBack ? styles.withBack : ""}`}
        >
          {hasBack ? (
            <button
              type="button"
              className={`${buttonClass("ghost", "md")} ${styles.iconButton}`}
              aria-label="Back"
              onClick={onBack}
            >
              {/* lucide's chevron-down, turned to point back. */}
              <ChevronDownIcon className={styles.backIcon} />
            </button>
          ) : null}
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {/*
           * A native button styled as the ghost one: `Button` passes no ref,
           * and this one is focused when the browser does not do it. A
           * confirm has none: its Cancel is the way out.
           */}
          {role === "alertdialog" ? null : (
            <button
              ref={closeRef}
              type="button"
              className={`${buttonClass("ghost", "md")} ${styles.iconButton} ${styles.close}`}
              aria-label="Close"
              onClick={onClose}
            >
              <XIcon />
            </button>
          )}
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  /** The question, as the dialog's heading and name: "Delete this post?". */
  title: string;
  /** What answering yes does, said before the buttons. */
  children: ReactNode;
  /** The button that does it: "Delete", "Report", "Deactivate". */
  confirmLabel: string;
  onConfirm: () => void;
  /** Cancel, Escape and the backdrop alike: nothing is done. */
  onCancel: () => void;
  /** While the request is in flight: the action is disabled, so one press is one request. */
  pending?: boolean;
  /** A failure, shown inside the confirm, which stays open. */
  failure?: string | null;
  /** For an action that removes something: the action button says so. */
  destructive?: boolean;
}

/**
 * A confirm (`FRONTEND-012`): this `Dialog` as an `alertdialog`, its question
 * the title, what it does its description, then Cancel and the action.
 *
 * **Focus starts on Cancel**, the answer that changes nothing, so an Enter
 * pressed by habit never deletes anything. It is moved from a passive effect,
 * which runs after `Dialog`'s layout effect has opened the element (a button in
 * a closed `<dialog>` cannot take focus). When it closes, `Dialog` puts focus
 * back on what opened it: for a post's confirms, the menu button.
 *
 * **A failure keeps it open**, as an alert inside it, so the reader can try
 * again or cancel knowing nothing happened.
 */
export function ConfirmDialog({ open, ...rest }: ConfirmDialogProps) {
  return open ? <OpenConfirm {...rest} /> : null;
}

function OpenConfirm({
  title,
  onCancel,
  ...body
}: Omit<ConfirmDialogProps, "open">) {
  const descriptionId = useId();
  return (
    <Dialog
      open
      role="alertdialog"
      title={title}
      describedBy={descriptionId}
      onClose={onCancel}
    >
      <ConfirmBody
        descriptionId={descriptionId}
        onCancel={onCancel}
        {...body}
      />
    </Dialog>
  );
}

function ConfirmBody({
  descriptionId,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  pending = false,
  failure = null,
  destructive = false,
}: Omit<ConfirmDialogProps, "open" | "title"> & { descriptionId: string }) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div className={styles.confirm}>
      <div id={descriptionId} className={styles.question}>
        {children}
      </div>
      {failure === null ? null : <InlineAlert>{failure}</InlineAlert>}
      <div className={styles.answers}>
        {/* Native buttons styled as `Button`s: `Button` passes no ref. */}
        <button
          ref={cancelRef}
          type="button"
          className={buttonClass("secondary", "md")}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className={`${buttonClass("primary", "md")}${destructive ? ` ${styles.destructive}` : ""}`}
          onClick={onConfirm}
          disabled={pending}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
