"""add notifications tables

Revision ID: a3f7c2e19b4d
Revises: 5d905ce8d9e1
Create Date: 2026-09-17 22:10:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a3f7c2e19b4d'
down_revision: str | Sequence[str] | None = '5d905ce8d9e1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('notifications',
    sa.Column('id', sa.BigInteger(), sa.Identity(always=True), nullable=False),
    sa.Column('recipient_user_id', sa.BigInteger(), nullable=False),
    sa.Column('type', sa.Enum('FOLLOW', 'REPLY', 'REPOST', name='notification_type'), nullable=False),
    sa.Column('actor_user_id', sa.BigInteger(), nullable=False),
    sa.Column('reference_id', sa.BigInteger(), nullable=True),
    sa.Column('cleared_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['actor_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['recipient_user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_notifications_recipient_user_id', 'notifications', ['recipient_user_id'], unique=False)
    op.create_table('notification_preferences',
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('email_notifications_enabled', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('user_id')
    )
    # ### end Alembic commands ###


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('notification_preferences')
    op.drop_index('ix_notifications_recipient_user_id', table_name='notifications')
    op.drop_table('notifications')
    # ### end Alembic commands ###
    # Adjusted by hand: autogenerate doesn't emit this, but the native
    # Postgres enum type created for `type` outlives drop_table and would
    # otherwise collide with itself on the next upgrade -- same fix as
    # 532f6a3d06fd's media_status enum.
    sa.Enum(name='notification_type').drop(op.get_bind(), checkfirst=True)
