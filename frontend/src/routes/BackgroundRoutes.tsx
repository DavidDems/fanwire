import { Suspense } from "react";
import {
  matchRoutes,
  useLocation,
  useRoutes,
  type Location,
  type RouteObject,
} from "react-router-dom";

import { StatusLine } from "../components/ui/StatusLine";
import {
  ModalFlowScope,
  useFlowBackground,
  useIsFlowEntry,
} from "./modal-flow";

export interface BackgroundRoutesProps {
  /** The app's pages: what fills `main`. */
  pages: RouteObject[];
  /**
   * Routes rendered over a page rather than instead of one: the modal's
   * details. One marked `flowOnly` opens over a page only as a step of a flow.
   */
  overlays: RouteObject[];
}

/** What an overlay route may carry in its `handle`. */
interface OverlayHandle {
  /**
   * Opened over a page only when a link made the entry a step of a flow; a
   * direct load of the address is the page of the same name instead
   * (`FRONTEND-014`: a game, a player).
   */
  flowOnly?: boolean;
}

/** `route`, marked to open over a page only as a step of a flow. */
export function flowOnly(route: RouteObject): RouteObject {
  const handle: OverlayHandle = { flowOnly: true };
  return { ...route, handle } as RouteObject;
}

function isFlowOnly(route: RouteObject): boolean {
  const handle: unknown = route.handle;
  return (
    typeof handle === "object" &&
    handle !== null &&
    (handle as OverlayHandle).flowOnly === true
  );
}

/** What the feed's address looks like when there is no page to keep underneath. */
const FEED: Partial<Location> = { pathname: "/" };

/**
 * The page in `main`, and a modal over it when the address is a modal's —
 * react-router's background-location recipe (`FRONTEND-010`).
 *
 * A link into the thread modal carries the page it was on as the flow's
 * background (`modal-flow.tsx`, the one reader of that state). While an
 * overlay route matches, the pages are matched against that background (or the
 * feed, for a direct load) instead of the real address, so the page underneath
 * is the one the reader left. The overlays render inside `ModalFlowScope`, so a
 * link in the modal continues the flow rather than starting one over it.
 *
 * **A detail that is also a page** (`flowOnly`: a game, a player) is an overlay
 * only when the entry is a step of a flow (`useIsFlowEntry`): opened from a
 * card, or from inside the modal. Loaded by its address it matches no overlay,
 * so the pages are matched against the real location and it is the full page
 * it always was. A thread has no page of its own, so it is always an overlay.
 *
 * **The page is never re-mounted for it.** The pages are always rendered here,
 * at this one position, and always against an explicit location — the real
 * one, or the background — so opening and closing a modal changes which
 * location is passed and nothing else. React keeps the same component
 * instance, which is what keeps the page's DOM, its local state, its data and
 * its scroll position. Switching between `<Outlet />` and something else at
 * this position is the re-mount this exists to avoid.
 *
 * **One Suspense for the lazy pages** (`FRONTEND-015`): a page's chunk is
 * waited for behind a loading line in `main`. It sits around the page alone,
 * so a lazy page never takes the modal over it down with it; the modal has
 * its own, inside its dialog (`DetailModal`).
 *
 * Mounted as the layout's one splat child, so the pages and overlays stay data
 * in `routes.tsx` and `AppLayout` keeps its plain `<Outlet />`.
 */
export function BackgroundRoutes({ pages, overlays }: BackgroundRoutesProps) {
  const location = useLocation();
  const matched = useRoutes(overlays);
  const inFlow = useIsFlowEntry();
  const flowOnlyMatch = (matchRoutes(overlays, location) ?? []).some(
    ({ route }) => isFlowOnly(route),
  );
  const overlay = flowOnlyMatch && !inFlow ? null : matched;
  const background = useFlowBackground();
  const underneath = overlay === null ? location : (background ?? FEED);
  const page = useRoutes(pages, underneath);

  return (
    <>
      <Suspense fallback={<StatusLine>Loading…</StatusLine>}>{page}</Suspense>
      <ModalFlowScope>{overlay}</ModalFlowScope>
    </>
  );
}
