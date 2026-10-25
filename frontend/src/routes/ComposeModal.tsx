import { Suspense, lazy, useContext, useEffect, useRef, useState } from "react";

import { Dialog } from "../components/ui/Dialog";
import { StatusLine } from "../components/ui/StatusLine";
import { ShellAccountStatus } from "./AppLayout";
import styles from "./ComposeModal.module.css";
import { RequireAuth } from "./guards";
import { useComposeClose } from "./modal-flow";

type ComposeModule = typeof import("../features/compose/ComposePage");

/** The composer's chunk, once it has arrived. */
let loaded: ComposeModule | null = null;
let loading: Promise<ComposeModule> | null = null;

function loadComposer(): Promise<ComposeModule> {
  loading ??= import("../features/compose/ComposePage").then((module) => {
    loaded = module;
    return module;
  });
  return loading;
}

// Its own chunk, waited for inside the dialog: the page underneath never
// waits for it (lazy-routes.test.ts).
const ComposePage = lazy(() =>
  loadComposer().then((m) => ({ default: m.ComposePage })),
);

/**
 * How long the dialog waits for what it shows before it opens on a loading
 * line instead: a still-loading account (long enough for the usual answer to
 * arrive first, so a guest or an account with no profile, who are sent
 * elsewhere, never sees a dialog flash before the redirect), and the
 * composer's chunk (so a quick one opens straight on the composer).
 */
const LOADING_GRACE_MS = 500;

/**
 * Compose as an overlay route (`FRONTEND-020`): UI-010's `Dialog`, titled
 * "Compose", over the page the reader opened it from, which `BackgroundRoutes`
 * keeps mounted underneath (or the feed, for a direct load or a reload). The
 * entry's state and its way out are `modal-flow.tsx`'s (`useComposeClose`):
 * Close, Escape, the backdrop and a published post all leave the same way.
 *
 * **The guard's rules are `RequireAuth`'s, unchanged.** Its redirects (a
 * guest to sign-in with this address as `from`, a profile-less account to
 * profile creation) are rendered before and instead of any dialog. Its other
 * states (loading, deactivated, unavailable) are rendered inside the dialog
 * in the composer's place, never below the page underneath; loading only
 * after a short grace, since it may still turn out to be a redirect. The
 * account state is the shell's (`ShellAccountStatus`), so opening compose asks
 * the API nothing; an active account gets the composer, which is what
 * `RequireAuth` renders for it.
 *
 * **The composer is its own chunk**, fetched when an active account opens
 * the dialog. The dialog opens once it has arrived, or after the grace on a
 * loading line inside it (the Suspense), never the page's.
 */
export function ComposeModal() {
  const status = useContext(ShellAccountStatus);
  const close = useComposeClose();
  const [graceOver, setGraceOver] = useState(false);
  const [ready, setReady] = useState(loaded !== null);
  // Whether the composer is rendered from the arrived chunk or through the
  // lazy one, decided once, so the chunk arriving never re-mounts it.
  const direct = useRef<boolean | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setGraceOver(true), LOADING_GRACE_MS);
    return () => clearTimeout(timer);
  }, []);

  const active = status === "active";
  useEffect(() => {
    if (active) void loadComposer().then(() => setReady(true));
  }, [active]);

  if (status === "anonymous" || status === "no-profile") {
    return <RequireAuth>{null}</RequireAuth>;
  }
  const waiting = status === "loading" || (active && !ready);
  if (waiting && !graceOver) return null;
  if (active) direct.current ??= ready;
  const Loaded = direct.current === true ? loaded?.ComposePage : undefined;

  return (
    <Dialog title="Compose" open onClose={close}>
      {/* Anchors the dialog at the top, so the composer grows it downward. */}
      <div className={styles.composer}>
        {!active ? (
          <RequireAuth>{null}</RequireAuth>
        ) : Loaded ? (
          <Loaded onPosted={close} />
        ) : (
          <Suspense fallback={<StatusLine>Loading…</StatusLine>}>
            <ComposePage onPosted={close} />
          </Suspense>
        )}
      </div>
    </Dialog>
  );
}
