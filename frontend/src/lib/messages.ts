/**
 * What every posting path shows when the API answers 429: the composer, the
 * reply box and a card's Repost. It is one line in three places, so it lives
 * here, where compose and feed can both import it without importing each
 * other (FRONTEND-054). It names no duration, no number and nothing the
 * server said: either of two windows can trip it, and no `Retry-After` comes.
 */
export const RATE_LIMITED_MESSAGE =
  "You’re going a bit fast. Wait a moment and try again.";
