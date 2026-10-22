import type { components } from "../../api/schema";

/**
 * The one sports-data link a post may carry (`POSTS-005`, `FRONTEND-013`).
 *
 * The type is the generated `CreatePostRequest.data_link` with its `null`
 * taken off, so it is exactly the three shapes the backend accepts and
 * nothing this file has to keep in step by hand:
 *
 * - `{ type: "game_final", ref_id: <game id> }`
 * - `{ type: "player_game", ref_id: <box-score line id> }`
 * - `{ type: "player_career", ref_id: <player id>, scope: "regular" | "playoffs" }`
 *
 * Only a career carries `scope`. "Sent exactly as attached" therefore means
 * *only its own keys*, which is why `copyDataLink` builds each shape field by
 * field instead of spreading: a spread would carry a stray key from whatever
 * object it was handed straight into the request body.
 */
export type DataLink = NonNullable<
  components["schemas"]["CreatePostRequest"]["data_link"]
>;

export type CareerScope = Extract<DataLink, { type: "player_career" }>["scope"];

/**
 * A detached copy with only the link's own keys.
 *
 * Every holder of a link — the draft, the snapshot, the template, the builder,
 * the request — goes through here, so no two of them ever share one object.
 * That is the media-id defect (`PostTemplate.test.ts`) in a new field: a link
 * the picker still holds, changed after it was attached, must not change the
 * draft it was attached to.
 */
export function copyDataLink(link: DataLink): DataLink {
  switch (link.type) {
    case "game_final":
      return { type: "game_final", ref_id: link.ref_id };
    case "player_game":
      return { type: "player_game", ref_id: link.ref_id };
    case "player_career":
      return { type: "player_career", ref_id: link.ref_id, scope: link.scope };
  }
}

/** `copyDataLink` for the nullable field a draft holds. */
export function copyDataLinkOrNull(link: DataLink | null): DataLink | null {
  return link === null ? null : copyDataLink(link);
}

/**
 * A string that names one link, for keying what the picker knows about it.
 * Two links with the same key are the same attachment.
 */
export function dataLinkKey(link: DataLink): string {
  return link.type === "player_career"
    ? `${link.type}:${link.ref_id}:${link.scope}`
    : `${link.type}:${link.ref_id}`;
}

/**
 * What a refused `data_link` means to the user, keyed by the machine code
 * `POST /posts` answers it with (`POSTS-005`, `app.posts.data_link`).
 *
 * The server checks again at posting time because data can change between
 * picking and posting, so the picker offering only what the server accepts
 * does not make these unreachable. Each message says what went wrong with the
 * attachment and what to do about it, and each is different, because "it did
 * not work" is the generic message's job. Anything not listed here — a code
 * this build has not heard of, Pydantic's own list-shaped 422, a 500 — keeps
 * the generic message: guessing at an unknown code would be worse than saying
 * nothing specific.
 */
const REFUSALS: Readonly<Record<string, string>> = {
  link_target_not_found:
    "We could not post that: the stats you attached no longer exist. Your draft is still here — remove them or attach something else.",
  game_not_completed:
    "We could not post that: the game you attached has not finished yet. Your draft is still here — remove it or attach a completed game.",
  player_did_not_play:
    "We could not post that: the player you attached did not play in that game. Your draft is still here — remove it or choose a player who played.",
  no_games_in_scope:
    "We could not post that: that player has no games in the part of their career you attached. Your draft is still here — remove it or choose the other one.",
  data_link_on_reply:
    "We could not post that: stats cannot be attached to a reply. Your draft is still here — remove the stats and try again.",
  data_link_needs_quote_text:
    "We could not post that: a repost with stats attached needs some text of your own. Your draft is still here — add a few words and try again.",
};

/** The message for a refused link, or `null` when `detail` is not one of the codes. */
export function refusalMessage(detail: unknown): string | null {
  if (typeof detail !== "string") return null;
  return Object.prototype.hasOwnProperty.call(REFUSALS, detail)
    ? REFUSALS[detail]
    : null;
}
