# FRONTEND-034: a reply shows what it answers

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## The human's ask (2026-11-05)

"If you click on a reply to a post, the original post is not visible, only its
reply." They want the reply on top at full size, with the original visible inside
the reply's card, smaller, as in the reference image (`reply_ui.jpg`, the
human's download, not in the repository): the replier's post with its media
and actions, the replied-to post as a compact box with a small avatar, a thread
line in the left gutter, and "Show this thread" at the foot.

This is the only change to post cards. Everything else about them stays as built.

## Decided

- **The parent box is the quote's box.** `QuotedOriginal` and `MissingOriginal`
  already are "a smaller post inside a post, with no controls". Reuse them, with
  an avatar added. Do not write a second compact card.
- **Order: reply content, parent box, action row, Show this thread.** The image
  puts the actions under the inner post. The actions are the reply's, which the
  accessible names already say.
- **No box in the thread's Replies list.** There the parent is the card directly
  above, so a box would repeat it in every row.
- **No "Replying to @user" line.** The box names the author already.

## Reuse

- `useOpenThreadOnClick(parent.id)` for the box, `ThreadTimeLink`, `threadPath`.
- `useDetailLinkState()` for Show this thread, so it continues the modal flow and
  Close still returns to the page underneath.

## Traps

- The card's own click handler: a click in the box must open the parent, and
  `preventDefault` there already stops the outer card from opening as well.
  Keep that.
- `PostNode` renders a plain repost from its `reposted_post`. The reply case
  applies to `subject`, not to `post`.
- `component-isolation` and `search-isolation` tests: `features/thread` may
  pass a prop to `PreparedPostNode`, but must not import anything new from feed.
