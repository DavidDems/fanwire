import { screen, within } from "@testing-library/react";

/**
 * The "Post about this" kit (`FRONTEND-017`): reading where a stats page's
 * post link points, and waiting until the page knows who is looking.
 *
 * The links go to `FRONTEND-013`'s pre-filled `/compose` address, so a link is
 * compared by its path and its query parameters, the parameters as a set:
 * nothing reads them in order, and a stray parameter (a `scope` on a game
 * result, say) is a different address that `dataLinkIn` refuses, so the set
 * must match exactly, not merely contain what was asked for.
 */

export interface ComposeTarget {
  pathname: string;
  /** Every `[key, value]` the query carries, sorted, duplicates kept. */
  params: [string, string][];
}

function sorted(entries: [string, string][]): [string, string][] {
  return [...entries].sort(([ak, av], [bk, bv]) =>
    ak === bk ? av.localeCompare(bv) : ak.localeCompare(bk),
  );
}

/** Where `href` points, as a path and a set of parameters. */
export function composeTarget(href: string | null): ComposeTarget {
  const url = new URL(href ?? "", "http://fanwire.test");
  return { pathname: url.pathname, params: sorted([...url.searchParams]) };
}

/** The `/compose` address carrying exactly `params`. */
export function composeAddress(
  params: Record<string, string | number>,
): ComposeTarget {
  return {
    pathname: "/compose",
    params: sorted(
      Object.entries(params).map(([key, value]) => [key, String(value)]),
    ),
  };
}

/** The pre-filled address for a game result. */
export function gameFinalAddress(gameId: number): ComposeTarget {
  return composeAddress({ link: "game_final", ref: gameId });
}

/** The pre-filled address for one played box-score line. */
export function playerGameAddress(
  lineId: number,
  gameId: number,
): ComposeTarget {
  return composeAddress({ link: "player_game", ref: lineId, game: gameId });
}

/** The pre-filled address for one scope of a player's career. */
export function playerCareerAddress(
  playerId: number,
  scope: "regular" | "playoffs",
): ComposeTarget {
  return composeAddress({ link: "player_career", ref: playerId, scope });
}

/** The name every "Post about this" link's accessible name starts from. */
export const POST_ABOUT = /post about/i;

/** Every "Post about …" link under `root`. */
export function postAboutLinks(root: HTMLElement): HTMLElement[] {
  return within(root).queryAllByRole("link", { name: POST_ABOUT });
}

/** Every link under `root` that points at `/compose`, whatever it is named. */
export function composeLinks(root: HTMLElement): HTMLElement[] {
  return within(root)
    .queryAllByRole("link")
    .filter(
      (link) =>
        composeTarget(link.getAttribute("href")).pathname === "/compose",
    );
}

/** The links under `root` that point at exactly `target`. */
export function linksTo(
  root: HTMLElement,
  target: ComposeTarget,
): HTMLElement[] {
  const want = JSON.stringify(target);
  return within(root)
    .queryAllByRole("link")
    .filter(
      (link) =>
        JSON.stringify(composeTarget(link.getAttribute("href"))) === want,
    );
}

/**
 * Resolve once the shell shows a signed-in member ("Your profile" in the
 * primary nav): by then `useAuth()` says `authenticated`, so an absent link is
 * absent because of the rule, not because the session had not loaded yet.
 */
export async function signedInShown(): Promise<void> {
  const nav = await screen.findByRole("navigation", { name: "Primary" });
  await within(nav).findByRole("link", { name: /^your profile$/i });
}

/**
 * Resolve once the shell offers "Sign in": `useAuth()` has settled on
 * `anonymous`, so an absent link is not merely one still loading.
 */
export async function signedOutShown(): Promise<void> {
  await screen.findByRole("link", { name: /^sign in$/i });
}
