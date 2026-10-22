"""PublishPostFacade — the single entry point for creating a post (Facade
pattern, per wiki/CodeContext/Standards/gof-patterns.md), per
wiki/CodeContext/Modules/0x00-architecture.md "Connection rule":
the data_link refusals (POSTS-005: post-level rules, then the target through
events/' validators) -> validation (moderation chain) -> confirm attached
media/ items are Processed -> persistence (the link's columns, a line's game
included) -> fan-out via PostEventBus. `#GameId` tokens in new text are no
longer parsed (POSTS-006): the text is stored as typed, no EventMention row
is created and no PostMentionedEvent published; legacy EventMention rows
stay readable through app.posts.service.mentioned_game_ids_by_post.

Per wiki/CodeContext/Modules/0x00-architecture.md "Connection rule", this
module imports app.posts.models, app.posts.moderation, app.posts.data_link
(which alone reaches app.events.service, for its validators and a line's
game), app.eventbus, and app.media.models.{Media, MediaStatus} -- the one place
posts/ touches media/'s Media rows directly. It reads Media.status via the
MediaStatus enum only (never app.media.state.transition -- posts/ never
mutates Media's pipeline state, only media/'s own pipeline does).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.eventbus import PostEventBus
from app.media.models import Media, MediaStatus
from app.posts.data_link import DataLink, DataLinkRefused
from app.posts.models import Post
from app.posts.moderation import ModerationCheck, ModerationContext

POST_CREATED = "PostCreated"


class PostNotFoundError(ValueError):
    """Raised when a post_id doesn't resolve to an existing, undeleted Post:
    here, for a reply's parent or a quote's original its owner deleted
    (app.posts.service raises it for the other interactions)."""


class MediaNotFoundError(Exception):
    """Raised when a requested media_id doesn't resolve to an existing
    Media row."""


class MediaNotProcessedError(Exception):
    """Raised when a requested media_id resolves to a Media row whose
    status is not MediaStatus.PROCESSED."""


@dataclass(frozen=True)
class CreatePostRequest:
    author_id: int
    text: str | None = None
    is_reply: bool = False
    parent_post_id: int | None = None
    is_repost: bool = False
    original_post_id: int | None = None
    media_ids: list[int] = field(default_factory=list)
    data_link: DataLink | None = None


class PublishPostFacade:
    """The single entry point for creating a post (wiki/CodeContext/
    Modules/0x00-architecture.md Connection rule). Sequences: refuse a
    deleted parent/original -> refuse a data_link (DataLinkRefused: on a
    reply, on a plain repost, or when a target events/'
    validator refuses) -> moderation chain -> confirm every attached Media
    is Processed -> persist Post (with the link's columns) -> attach Media
    (set Media.post_id) -> commit -> fan-out on PostEventBus. This is the
    ONE place posts/ touches media/'s Media rows directly, and creates a
    post's link through app.posts.data_link -- everywhere else in posts/
    goes through this same boundary."""

    def __init__(
        self,
        session: Session,
        moderation_chain: ModerationCheck,
        event_bus: PostEventBus,
    ) -> None:
        self._session = session
        self._moderation_chain = moderation_chain
        self._event_bus = event_bus

    def publish(self, request: CreatePostRequest) -> Post:
        # 0. A deleted parent/original takes no new reply or repost (POSTS-004).
        # An unknown id is left to the FK, an IntegrityError, as before.
        for referenced_id in (request.parent_post_id, request.original_post_id):
            if referenced_id is None:
                continue
            referenced = self._session.get(Post, referenced_id)
            if referenced is not None and referenced.deleted_at is not None:
                raise PostNotFoundError(f"No Post with id={referenced_id!r}")

        # 0b. A data_link (POSTS-005): the post-level rules, then the target
        # through events/' validators. Raises DataLinkRefused; nothing is
        # written yet.
        if request.data_link is not None:
            self._check_data_link(request, request.data_link)

        # 1. Moderation chain -- raises PostRejected to halt; propagates
        # uncaught, a future route decides how to turn it into an HTTP
        # response.
        self._moderation_chain.handle(
            ModerationContext(author_id=request.author_id, text=request.text)
        )

        # 2. Validate every attached Media up front -- fail fast, don't
        # half-attach.
        media_rows: list[Media] = []
        for media_id in request.media_ids:
            media = self._session.get(Media, media_id)
            if media is None:
                raise MediaNotFoundError(f"No Media with id={media_id!r}")
            if media.status is not MediaStatus.PROCESSED:
                raise MediaNotProcessedError(
                    f"Media id={media_id!r} is not Processed (status={media.status!r})"
                )
            media_rows.append(media)

        # 3. Persist the Post.
        post = Post(
            author_id=request.author_id,
            text=request.text,
            is_reply=request.is_reply,
            parent_post_id=request.parent_post_id,
            is_repost=request.is_repost,
            original_post_id=request.original_post_id,
            **(request.data_link.columns(self._session) if request.data_link is not None else {}),
        )
        self._session.add(post)
        self._session.flush()

        # 4. Attach already-validated Media.
        for media in media_rows:
            media.post_id = post.id

        # 5. Commit.
        self._session.commit()

        # 6. Fan-out.
        self._event_bus.publish(POST_CREATED, {"post_id": post.id, "author_id": post.author_id})

        return post

    def _check_data_link(self, request: CreatePostRequest, data_link: DataLink) -> None:
        """A data_link is refused on a reply and on a plain repost (no text
        of its own); then its target must pass events/' validator. A
        #GameId token beside it is just text (POSTS-006)."""
        if request.is_reply:
            raise DataLinkRefused("data_link_on_reply")
        if request.is_repost and not request.text:
            raise DataLinkRefused("data_link_needs_quote_text")
        data_link.validate_target(self._session)
