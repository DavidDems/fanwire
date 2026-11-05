# FEED-001: consistent public content for new accounts

Prose for the Manager. The contract is `task.json`.

## Current observation

On the deployed site, signed-out visitors and older accounts see existing public
posts. A newly created account's feed is empty even when those posts exist. If
the new account publishes a post, that post appears in its own feed while the
guest feed continues to show the public posts. The cause is not known: reproduce
and trace the signed-out and signed-in feed paths before selecting a fix.

## Product rule

Public posts available to a guest should not disappear merely because the
viewer has just signed up or follows nobody. Existing visibility and ordering
rules remain authoritative; do not invent posts for an actually empty dataset.
No account-created timestamp is a feed cutoff. A new user's public post is
visible to that user and to signed-out guests, and eligible existing users keep
seeing it under the feed's current public-post behavior.

## Boundaries

The unit can inspect and modify the feed module, the posts module's public
service interface, and the frontend feed. It does not change authentication or
user-table rules. Feed must continue to query posts through the public posts
interface and preserve visibility, deactivation, pagination and card behavior.
Explain the reproduced root cause and any data or migration consequence in the
PR. Do not create a migration without proving it is needed.
