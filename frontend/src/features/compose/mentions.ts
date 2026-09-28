/**
 * The mention grammar: what a trigger opens, and what a chosen suggestion writes.
 *
 * The two tokens are deliberately asymmetric ([[0x03-posts]], `EventMention` →
 * Open decisions, "Scope note"):
 *
 * - `#GameId<digits>` is the only token `app.posts.mentions.MentionParser`
 *   implements, so a chosen game has to insert exactly that or the backend
 *   creates no `EventMention` row and the attachment silently does nothing.
 * - `$TEAM` is deliberately not implemented there — a bare abbreviation does not
 *   identify one `Game` and `EventMention.game_id` is `NOT NULL`. The backend
 *   keeps the post text exactly as authored and creates no mention, so `$TOR` is
 *   carried in the text and resolves to nothing. That is the contract, not a gap
 *   to work around: this unit does not invent a resolution rule or a different
 *   `$` format.
 *
 * `activeMentionQuery` lives here rather than in the dropdown so that the
 * mediator replaces the same run of text the dropdown was offering against, and
 * neither has to guess what the other meant. It reads the *end* of the text and
 * nothing else — there is no caret tracking, which keeps one rule instead of two
 * and makes the whole grammar a pure function of the draft.
 */

export type MentionTrigger = "#" | "$";

export interface MentionQuery {
  trigger: MentionTrigger;
  /** What has been typed after the trigger, possibly empty. */
  query: string;
}

/** The token a chosen game inserts — the form the backend's parser matches. */
export function gameMentionToken(gameId: number): string {
  return `#GameId${gameId}`;
}

/** The token a chosen team inserts. Upper-cased, and resolved by nobody. */
export function teamMentionToken(abbreviation: string): string {
  return `$${abbreviation.toUpperCase()}`;
}

/**
 * A trigger, then an unbroken alphanumeric run, then the end of the text.
 *
 * Anchoring at the end is what closes the dropdown once a space follows the
 * token: without it the suggestions never go away and the mediator would replace
 * a finished token with the next selection. `@` is absent on purpose — it has no
 * backend grammar and no table.
 */
const ACTIVE_MENTION = /([#$])([A-Za-z0-9]*)$/;

/** What the composer is currently completing, or `null` if it is not. */
export function activeMentionQuery(text: string): MentionQuery | null {
  const match = ACTIVE_MENTION.exec(text);
  if (match === null) return null;

  return { trigger: match[1] as MentionTrigger, query: match[2] };
}

/** How many characters at the end of the text the active mention occupies. */
export function activeMentionLength(active: MentionQuery): number {
  return active.trigger.length + active.query.length;
}
