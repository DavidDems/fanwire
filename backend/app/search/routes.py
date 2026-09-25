"""search/ HTTP routes -- thin orchestration only. search/ owns no tables
(wiki/CodeContext/Modules/0x07-search.md): full-text search reads
users/'s and posts/'s tested public search functions
(app.users.service.search_users / app.posts.service.search_posts), and
the sports-data filter reads events/'s (app.events.service.filter_games /
distinct_seasons). This module never queries User/Post/Game directly.

Two distinct mechanisms, per 0x07-search.md:
- GET /search/accounts, GET /search/posts: Postgres tsvector full-text
  search, two independently paginated sections (accounts-first is a
  frontend ordering concern -- the backend just exposes two separate
  endpoints, each with its own limit/offset/next_offset).
- GET /search/games, GET /search/games/filters: plain WHERE-clause
  filtering, no free-text search bar for sports data (business rule).

GET /search/posts reuses app.feed.views.assemble_post_views (the same
cross-module view-assembly feed/ uses) -- viewer via
get_optional_current_user, live scores via get_live_score_proxy, exactly
like app.feed.routes.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.dependencies import get_session
from app.events.dependencies import get_live_score_proxy
from app.events.proxy import CachedEventProxy
from app.events.schemas import GameOut
from app.events.service import ALLOWED_POSITIONS, distinct_seasons, filter_games
from app.feed.views import assemble_post_views
from app.posts.service import search_posts as search_post_rows
from app.search.schemas import (
    AccountResult,
    AccountsPage,
    GameFiltersOut,
    GamesPage,
    PostsPage,
)
from app.users.dependencies import get_optional_current_user
from app.users.models import User
from app.users.service import search_users

router = APIRouter(prefix="/search", tags=["search"])

_DEFAULT_LIMIT = 20
_MAX_LIMIT = 50


def _next_offset(offset: int, limit: int, returned_count: int) -> int | None:
    """offset + limit when a full page came back (there may be more),
    else None -- per wiki/CodeContext/Modules/0x07-search.md."""
    return offset + limit if returned_count == limit else None


@router.get("/accounts", response_model=AccountsPage, summary="Drift gate negative test")
def search_accounts(
    q: str = Query(..., min_length=1, max_length=100),
    limit: int = Query(default=_DEFAULT_LIMIT, ge=1, le=_MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
) -> AccountsPage:
    users = search_users(session, q.strip(), limit=limit, offset=offset)
    items = [AccountResult.model_validate(user) for user in users]
    return AccountsPage(items=items, next_offset=_next_offset(offset, limit, len(users)))


@router.get("/posts", response_model=PostsPage)
def search_posts(
    q: str = Query(..., min_length=1, max_length=100),
    limit: int = Query(default=_DEFAULT_LIMIT, ge=1, le=_MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    viewer: User | None = Depends(get_optional_current_user),
    session: Session = Depends(get_session),
    live_score_proxy: CachedEventProxy | None = Depends(get_live_score_proxy),
) -> PostsPage:
    posts = search_post_rows(session, q.strip(), limit=limit, offset=offset)
    items = assemble_post_views(
        session,
        posts,
        viewer_id=viewer.id if viewer is not None else None,
        live_scores=live_score_proxy,
    )
    return PostsPage(items=items, next_offset=_next_offset(offset, limit, len(posts)))


@router.get("/games", response_model=GamesPage)
def search_games(
    season: str | None = None,
    team_id: int | None = None,
    position: str | None = None,
    limit: int = Query(default=_DEFAULT_LIMIT, ge=1, le=_MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
) -> GamesPage:
    # Validated at the boundary, per wiki/CodeContext/Modules/
    # 0x07-search.md -- an unknown position is a 422, not silently ignored
    # or passed through to a query that would just match nothing.
    if position is not None and position not in ALLOWED_POSITIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unknown position: {position!r}. Must be one of {ALLOWED_POSITIONS}.",
        )

    games = filter_games(
        session, season=season, team_id=team_id, position=position, limit=limit, offset=offset
    )
    items = [GameOut.model_validate(game) for game in games]
    return GamesPage(items=items, next_offset=_next_offset(offset, limit, len(games)))


@router.get("/games/filters", response_model=GameFiltersOut)
def game_filters(session: Session = Depends(get_session)) -> GameFiltersOut:
    """Teams come from the existing GET /events/teams -- not duplicated
    here, per wiki/CodeContext/Modules/0x07-search.md."""
    return GameFiltersOut(seasons=distinct_seasons(session), positions=list(ALLOWED_POSITIONS))
