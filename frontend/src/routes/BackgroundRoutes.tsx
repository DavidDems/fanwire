import {
  useLocation,
  useRoutes,
  type Location,
  type RouteObject,
} from "react-router-dom";

import { ModalFlowScope, useFlowBackground } from "./modal-flow";

export interface BackgroundRoutesProps {
  /** The app's pages: what fills `main`. */
  pages: RouteObject[];
  /** Routes rendered over a page rather than instead of one: the thread modal. */
  overlays: RouteObject[];
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
 * **The page is never re-mounted for it.** The pages are always rendered here,
 * at this one position, and always against an explicit location — the real
 * one, or the background — so opening and closing a modal changes which
 * location is passed and nothing else. React keeps the same component
 * instance, which is what keeps the page's DOM, its local state, its data and
 * its scroll position. Switching between `<Outlet />` and something else at
 * this position is the re-mount this exists to avoid.
 *
 * Mounted as the layout's one splat child, so the pages and overlays stay data
 * in `routes.tsx` and `AppLayout` keeps its plain `<Outlet />`.
 */
export function BackgroundRoutes({ pages, overlays }: BackgroundRoutesProps) {
  const location = useLocation();
  const overlay = useRoutes(overlays);
  const background = useFlowBackground();
  const underneath = overlay === null ? location : (background ?? FEED);
  const page = useRoutes(pages, underneath);

  return (
    <>
      {page}
      <ModalFlowScope>{overlay}</ModalFlowScope>
    </>
  );
}
