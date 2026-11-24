"""add indexes on reports (reporter_id, created_at) and media (uploader_id, created_at)

Revision ID: f2b8d4a6c9e3
Revises: 9c009a110001
Create Date: 2026-11-24 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2b8d4a6c9e3"
down_revision: str | Sequence[str] | None = "9c009a110001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    app.posts.moderation.ReportCountRateLimiter and
    app.media.rate_limit.MediaCountRateLimiter (POSTS-010) count one user's
    reports / uploads of the last hour on every report / upload: index range
    scans, not table scans. Neither table had an equivalent index (reports'
    only one, uq_reports_post_reporter, leads with post_id). Not needed for
    correctness, so the app works between the deploy and this migration.
    """
    op.create_index(
        "ix_reports_reporter_id_created_at",
        "reports",
        ["reporter_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_media_uploader_id_created_at",
        "media",
        ["uploader_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_media_uploader_id_created_at", table_name="media")
    op.drop_index("ix_reports_reporter_id_created_at", table_name="reports")
