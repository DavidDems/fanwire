import { GamePage } from "../features/games/GamePage";
import { PlayerPage } from "../features/players/PlayerPage";
import { useDetailTitle } from "../features/thread/DetailModal";

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
