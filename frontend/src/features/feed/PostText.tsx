import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/** A game mention as the composer writes it; the digits are the game's id. */
const GAME_MENTION = /#GameId(\d+)/g;

export interface PostTextProps {
  text: string;
  /** The ids the server resolved to a real game; only these are linked. */
  mentionedGameIds: readonly number[];
  className?: string;
}

/**
 * A post's text, with each `#GameId<n>` the server resolved turned into a link
 * to `/games/<n>` (by address: the feed never imports the games feature).
 *
 * The text is split into strings and links and handed to React as nodes, so it
 * is never parsed as HTML: markup in a post reads literally. A token whose id
 * is not in `mentionedGameIds` did not resolve to a game and stays plain text,
 * and `\d+` is greedy, so `#GameId5012` is the id 5012, never 501 and a "2".
 */
export function PostText({ text, mentionedGameIds, className }: PostTextProps) {
  const mentioned = new Set(mentionedGameIds);
  const nodes: ReactNode[] = [];
  let last = 0;

  for (const match of text.matchAll(GAME_MENTION)) {
    const id = Number(match[1]);
    if (!mentioned.has(id)) continue;
    const start = match.index;
    if (start > last) nodes.push(text.slice(last, start));
    nodes.push(
      <Link key={start} to={`/games/${id}`}>
        {match[0]}
      </Link>,
    );
    last = start + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));

  return <p className={className}>{nodes}</p>;
}
