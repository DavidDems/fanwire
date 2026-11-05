import { useEffect, useRef, useState } from "react";

import { buttonClass } from "./Button";
import { LinkIcon } from "./icons";
import styles from "./InviteButton.module.css";

/** How long the button reads "Copied" after a copy. */
const COPIED_MS = 2000;

type Outcome = "idle" | "copied" | "manual";

/**
 * The Invite button (`FRONTEND-032`): fixed beside the floating compose button,
 * it copies the site's root, `window.location.origin + "/"`, which is the guest
 * feed a signed-out friend sees. Nothing goes to the network, and no query or
 * tracking parameter is added.
 *
 * On a copy it reads "Copied" for 2 seconds (a second press restarts them) and
 * a polite, visually hidden live region says "Link copied". Where the clipboard
 * is missing (outside a secure context) or refuses, a read-only field above the
 * button holds the address, focused and selected, for copying by hand; Escape
 * in it puts it away and focus back on the button. It is rendered before the
 * button, so Invite and compose stay next to each other in the tab order.
 *
 * Button secondary's classes give its colours, edge and focus ring.
 */
export function InviteButton() {
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const address = `${window.location.origin}/`;

  function stopTimer(): void {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }

  useEffect(() => stopTimer, []);

  async function copy(): Promise<void> {
    // Missing outside a secure context, and in jsdom.
    const clipboard = navigator.clipboard as Clipboard | undefined;
    try {
      if (clipboard === undefined) throw new Error("No clipboard here.");
      await clipboard.writeText(address);
    } catch {
      stopTimer();
      setOutcome("manual");
      return;
    }
    stopTimer();
    setOutcome("copied");
    timer.current = setTimeout(() => {
      timer.current = null;
      setOutcome("idle");
    }, COPIED_MS);
  }

  return (
    <div className={styles.invite}>
      {outcome === "manual" ? (
        <ManualCopy
          address={address}
          onDismiss={() => {
            setOutcome("idle");
            buttonRef.current?.focus();
          }}
        />
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        className={`${buttonClass("secondary", "md")} ${styles.control}`}
        onClick={() => {
          void copy();
        }}
      >
        <LinkIcon />
        <span className={styles.label}>
          <span className={styles.word}>
            {outcome === "copied" ? "Copied" : "Invite"}
          </span>
        </span>
      </button>
      <span role="status" className="visually-hidden">
        {outcome === "copied" ? "Link copied" : ""}
      </span>
    </div>
  );
}

/** The address in a read-only field, focused and wholly selected. */
function ManualCopy({
  address,
  onDismiss,
}: {
  address: string;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, [address]);

  return (
    <label className={styles.manual}>
      <span className={styles.manualLabel}>Copy this link</span>
      <input
        ref={ref}
        className={styles.address}
        type="text"
        readOnly
        value={address}
        onFocus={(event) => {
          event.currentTarget.select();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onDismiss();
        }}
      />
    </label>
  );
}
