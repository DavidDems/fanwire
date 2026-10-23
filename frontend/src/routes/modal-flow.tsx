import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, type Location } from "react-router-dom";

/**
 * The modal flow (`FRONTEND-011`): the run of details — a thread today, a game
 * or a player later (`FRONTEND-014`) — opened one from another inside the one
 * modal, over the page the reader started from.
 *
 * **The flow lives in history state, and only this module reads it.** Every
 * detail's entry carries `{ background, depth }`: `background` is the origin
 * page's own location (absent for a direct load or a reload, where there is
 * none), and `depth` counts the details from the flow's first, which is 1. A
 * link into a detail takes its `state` from `useDetailLinkState`; the modal
 * takes its way out and its Back from `useModalFlow`; `BackgroundRoutes` takes
 * the page to keep underneath from `useFlowBackground`. Nothing else knows the
 * shape, so a new kind of detail is a new overlay route, not a change here.
 *
 * **Inside or outside the flow is where the link is, not what the address
 * is.** `BackgroundRoutes` renders its overlays inside `ModalFlowScope`, so a
 * link anywhere in the modal continues the flow (`depth` + 1, the same
 * background) and a link on a page starts one (`depth` 1, that page).
 *
 * **Leaving.** Close and Escape go back `depth` entries when there is a
 * background, which is the origin's own entry: its address, its search string
 * and the page as the reader left it. With none, they go back to the flow's
 * first entry (`depth - 1`) and replace it with `/`, so nothing before the
 * app's own first entry is ever reached. Back is one entry, the previous
 * detail, and is offered only when there is one.
 */

/** What a detail's history entry carries. */
export interface ModalFlowState {
  /** The origin page, kept rendered under the modal; absent with no origin. */
  background?: Location;
  /** This detail's place in the flow: 1 for the first. */
  depth: number;
}

/** The flow the current entry belongs to, as read from its state. */
interface ModalFlow {
  background: Location | null;
  depth: number;
}

/**
 * History state is whatever the entry was given, by this app or by a previous
 * version of it, so it is checked rather than cast: anything that is not the
 * flow's shape is a flow with no origin at its first detail.
 */
function flowOf(location: Location): ModalFlow {
  const state: unknown = location.state;
  if (typeof state !== "object" || state === null) {
    return { background: null, depth: 1 };
  }
  const { background, depth } = state as Record<string, unknown>;
  return {
    background: isLocation(background) ? background : null,
    depth:
      typeof depth === "number" && Number.isSafeInteger(depth) && depth > 0
        ? depth
        : 1,
  };
}

function isLocation(value: unknown): value is Location {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { pathname?: unknown }).pathname === "string"
  );
}

/** Whether the component is rendered inside the modal rather than on a page. */
const InFlow = createContext(false);

/** Marks its children as inside the flow: `BackgroundRoutes` wraps its overlays. */
export function ModalFlowScope({ children }: { children: ReactNode }) {
  return <InFlow.Provider value>{children}</InFlow.Provider>;
}

/**
 * The page to keep rendered under the modal: the current entry's origin, or
 * `null` when it has none (a direct load or a reload).
 */
export function useFlowBackground(): Location | null {
  return flowOf(useLocation()).background;
}

/**
 * The `state` for a link that opens a detail. On a page, it starts a flow over
 * that page; inside the modal, it continues the open one: one deeper, over the
 * same origin (or, with none, still with none).
 */
export function useDetailLinkState(): ModalFlowState {
  const inFlow = useContext(InFlow);
  const location = useLocation();
  if (!inFlow) return { background: location, depth: 1 };
  const { background, depth } = flowOf(location);
  return background === null
    ? { depth: depth + 1 }
    : { background, depth: depth + 1 };
}

/**
 * The `state` for a link *inside a detail* (`FRONTEND-014`: a box score's
 * player names, a game log's rows, a `#GameId` in a post's text): inside the
 * modal it continues the flow, exactly as `useDetailLinkState` does; on a page
 * it is `undefined`, so the link stays the plain navigation to a full page it
 * always was.
 */
export function useInFlowLinkState(): ModalFlowState | undefined {
  const inFlow = useContext(InFlow);
  const state = useDetailLinkState();
  return inFlow ? state : undefined;
}

/**
 * Whether the current entry is a step of a flow that a link opened: it has an
 * origin, or it is past the flow's first detail. A direct load or a reload of a
 * detail's address is neither, which is how `BackgroundRoutes` tells a game or
 * a player opened from a card (a modal) from one loaded by address (a page).
 */
export function useIsFlowEntry(): boolean {
  const { background, depth } = flowOf(useLocation());
  return background !== null || depth > 1;
}

/** What the modal needs from the flow to offer its ways out. */
export interface ModalFlowControls {
  /** The current detail's place in the flow: 1 for the first. */
  depth: number;
  /** Step to the previous detail; `undefined` at the first, where there is none. */
  back: (() => void) | undefined;
  /** Leave the whole flow, for Close and Escape alike. */
  close: () => void;
}

/**
 * The flow's ways out, for the component that renders the modal. It must stay
 * mounted for the whole flow (one modal surface whose details switch inside
 * it), which is also what lets a close with no origin finish: it steps back to
 * the flow's first entry, and replaces that with `/` once the step has landed.
 */
export function useModalFlow(): ModalFlowControls {
  const location = useLocation();
  const navigate = useNavigate();
  const { background, depth } = flowOf(location);
  // Set while a close is under way, so a second press before the history step
  // lands does not step back as far again, past the origin.
  const leavingRef = useRef(false);
  // Set while a close with no origin waits to reach the flow's first entry.
  const homeNextRef = useRef(false);

  useEffect(() => {
    if (!homeNextRef.current) {
      leavingRef.current = false;
      return;
    }
    homeNextRef.current = false;
    void navigate("/", { replace: true });
  }, [location.key, navigate]);

  function close(): void {
    if (leavingRef.current) return;
    leavingRef.current = true;
    if (background !== null) {
      void navigate(-depth);
    } else if (depth === 1) {
      void navigate("/", { replace: true });
    } else {
      homeNextRef.current = true;
      void navigate(-(depth - 1));
    }
  }

  return {
    depth,
    back:
      depth > 1
        ? () => {
            void navigate(-1);
          }
        : undefined,
    close,
  };
}
