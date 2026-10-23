import { useId, useState } from "react";

import { useRecoverAccount, useSignOut } from "../auth/account";
import { Button } from "../components/ui/Button";
import { InlineAlert } from "../components/ui/InlineAlert";
import styles from "./Deactivated.module.css";

/**
 * What a deactivated account sees (`FRONTEND-012`, on `USERS-003`). Decided by
 * the human (2026-10-22): **gated on writes, not locked out**. Public pages
 * browse as a guest under `DeactivatedBanner`; a signed-in-only route shows
 * `RecoveryScreen` in its place (`./guards`). Both offer the same two ways
 * on: Recover account, and Sign out.
 */

/**
 * Recover account and Sign out, with recovery's failure beside them.
 *
 * Recovering is one `POST /users/me/recover`: the button is disabled while it
 * is in flight, so one press is one request. On its 200 every cached query is
 * read again (`useRecoverAccount`), the profile among them, and the whole app
 * moves back to the active state: this control goes with the banner or the
 * screen it sits in.
 */
function RecoveryActions() {
  const recover = useRecoverAccount();
  const signOut = useSignOut();
  const [failure, setFailure] = useState<string | null>(null);

  return (
    <div className={styles.actions}>
      <div className={styles.buttons}>
        <Button
          type="button"
          variant="primary"
          size="md"
          disabled={recover.isPending}
          onClick={() => {
            setFailure(null);
            recover.mutate(undefined, {
              onError: () => {
                // Never the failure's own text: a status line is not something
                // the reader can act on, and trying again is.
                setFailure(
                  "We could not recover your account just now. Please try again.",
                );
              },
            });
          }}
        >
          Recover account
        </Button>
        <Button type="button" variant="secondary" size="md" onClick={signOut}>
          Sign out
        </Button>
      </div>
      {failure === null ? null : <InlineAlert>{failure}</InlineAlert>}
    </div>
  );
}

/**
 * The persistent notice on every page, between the header and `main`.
 *
 * **A named region, not a second `<header>`**: the page keeps its one banner
 * landmark (`accessibility.md` A12), and the region is named by its own first
 * line, so it is found and announced as "Your account is deactivated".
 *
 * **It takes focus only when asked** (`focusDeactivatedBanner`, after
 * Deactivate account): `tabindex="-1"` lets script focus it without adding a
 * tab stop, and a page that merely opens deactivated leaves focus alone.
 */
export function DeactivatedBanner() {
  const titleId = useId();
  return (
    <div className={styles.slot}>
      <section
        id={BANNER_ID}
        className={styles.banner}
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className={styles.bannerText}>
          <p id={titleId} className={styles.bannerTitle}>
            Your account is deactivated
          </p>
          <p className={styles.muted}>
            Your profile and posts are hidden. You can read as a guest, or
            recover the account to post, like and follow again.
          </p>
        </div>
        <RecoveryActions />
      </section>
    </div>
  );
}

const BANNER_ID = "deactivated-banner";

/**
 * Move focus to the banner once it is on the page: after Deactivate account,
 * whose own-profile view (and the button that had focus) is replaced as the
 * app moves to the deactivated state, so focus would otherwise fall to the
 * page. Watched rather than done at once, because the banner arrives on the
 * render after the profile is read again.
 */
export function focusDeactivatedBanner(): void {
  const settle = (): boolean => {
    const banner = document.getElementById(BANNER_ID);
    if (banner === null) return false;
    banner.focus();
    return true;
  };
  if (settle()) return;
  const observer = new MutationObserver(() => {
    if (settle()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * A signed-in-only route's content, for a deactivated account: what recovery
 * does and what it does not, then the same two ways on. Shown on the route
 * that was asked for, so recovering renders that route.
 */
export function RecoveryScreen() {
  return (
    <div className={styles.screen}>
      <h1>Your account is deactivated</h1>
      <p>
        Recovering it restores your account and your posts, so others can see
        them again. Posts you deleted one by one stay deleted.
      </p>
      <RecoveryActions />
    </div>
  );
}
