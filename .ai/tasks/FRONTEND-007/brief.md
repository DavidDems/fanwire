# FRONTEND-007 — search, as two separate things

Depends on `FRONTEND-005` being on `main` (post results render through its
Composite components).

## Two mechanisms, and they are not variants of one

`0x07-search.md` describes **two distinct search mechanisms**, and this unit
builds two distinct UIs. They share no component and no state.

**(a) Free-text search** over accounts and posts. A bar on the home page and on
the search route. Two independent calls, two independent paginations, accounts
rendered above posts.

**(b) Sports-data filtering**, with **no text input at all**. Season dropdown,
team dropdown, position dropdown, and a results list from
`GET /search/games`.

## The constraint that is most likely to be quietly violated

**There is no free-text search bar for sports data.** That is a business rule,
recorded in `wiki/GeneralContext/Architecture/business-rules.md` and carried
into `0x07-search.md` — not a UX preference, and not something to soften by
adding "a small filter box, just to narrow the dropdown".

A dropdown with a type-ahead filter *is* a text input. The acceptance criterion
is written as the absence of every `textbox` and `searchbox` role inside the
sports-data UI, so a combobox with an editable input will fail it. That is
intended.

Write that test first. It is the one a reasonable implementer breaks without
noticing, because adding a filter to a long team list feels like an
improvement.

## Reuse, not reimplementation

Post results render through `FRONTEND-005`'s `PostNode` components.
`frontend/src/features/feed/**` is in `forbidden_paths`, so those components are
imported, not copied and not edited. If what feed exposes is not enough to
render a search result, that is a change to the feed unit and a new task — say
so rather than growing the diff.

## Pagination

Both free-text result lists paginate on their own `next_offset`. Loading more
accounts must not refetch posts. Two lists sharing one offset is the bug this
criterion is written against, and it only shows up once the two result sets have
different lengths.
