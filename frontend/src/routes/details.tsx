import { lazy } from "react";

import { useDetailTitle } from "../features/thread/DetailModal";

// The same chunks the pages load (`routes.tsx`), waited for behind the
// Suspense inside `DetailModal`, so the dialog stays open meanwhile.
const GamePage = lazy(() =>
  import("../features/games/GamePage").then((m) => ({ default: m.GamePage })),
);
const PlayerPage = lazy(() =>
  import("../features/players/PlayerPage").then((m) => ({
    default: m.PlayerPage,
  })),
);

/**
 * A game and a player as details of the modal flow (`FRONTEND-014`): the very
 * pages a direct load shows, rendered inside `DetailModal`'s one dialog and
 * named for its title. Kept here rather than in either feature, because the
 * route table is the one place allowed to put one feature inside another's
 * surface; the pages themselves know only that a link inside the modal
 * continues the flow (`useInFlowLinkState`).
 */
export function GameDetail() {
  useDetailTitle("Game");
  return <GamePage />;
}

/** A player, as a detail of the modal flow: see `GameDetail`. */
export function PlayerDetail() {
  useDetailTitle("Player");
  return <PlayerPage />;
}
