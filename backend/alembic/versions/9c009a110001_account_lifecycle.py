"""Durable account authority and retained cleanup work."""
import sqlalchemy as sa

from alembic import op
from app.settings import Settings

revision = "9c009a110001"
down_revision = "217f70776078"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("account_authorities",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), primary_key=True),
        sa.Column("issuer", sa.Text(), nullable=False),
        sa.Column("cognito_sub", sa.Text(), nullable=False),
        sa.Column("state", sa.Text(), nullable=False),
        sa.Column("generation", sa.BigInteger(), nullable=False),
        sa.Column("inactive_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("issuer", "cognito_sub", name="uq_account_authority_subject"),
        sa.CheckConstraint("state IN ('active','inactive','deleting','deleted')", name="ck_account_authority_state"),
        sa.CheckConstraint("generation > 0", name="ck_account_authority_generation"))
    op.create_table("account_operations",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), primary_key=True),
        sa.Column("authority_id", sa.BigInteger(), sa.ForeignKey("account_authorities.id"), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("operation_id", sa.Text(), nullable=False, unique=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("stage", sa.Text(), nullable=False),
        sa.Column("generation", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger()),
        sa.Column("post_ids", sa.JSON(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("lease_epoch", sa.BigInteger(), nullable=False),
        sa.Column("lease_until", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("kind IN ('delete','deactivate','recover')", name="ck_account_operation_kind"),
        sa.CheckConstraint("status IN ('in_progress','retrying','completed')", name="ck_account_operation_status"))
    op.create_index("uq_account_delete_intent", "account_operations", ["authority_id"], unique=True, postgresql_where=sa.text("kind = 'delete'"))
    op.create_index("ix_account_work_due", "account_operations", ["kind", "next_attempt_at"])
    op.create_table("account_deletion_objects",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), primary_key=True),
        sa.Column("operation_id", sa.BigInteger(), sa.ForeignKey("account_operations.id"), nullable=False),
        sa.Column("bucket", sa.Text(), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("removed", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("operation_id", "bucket", "key", name="uq_account_deletion_object"))
    settings = Settings()
    if not settings.cognito_region or not settings.cognito_user_pool_id:
        if op.get_bind().execute(sa.text("SELECT count(*) FROM users")).scalar_one():
            raise RuntimeError("Trusted namespace required for profile backfill")
        return
    issuer = ("https://perf.fanwire.local/issuer" if settings.environment == "perf" and settings.perf_jwks_path else f"https://cognito-idp.{settings.cognito_region}.amazonaws.com/{settings.cognito_user_pool_id}")
    op.get_bind().execute(sa.text("INSERT INTO account_authorities (issuer,cognito_sub,state,generation,inactive_at) SELECT :issuer,cognito_sub,CASE WHEN deleted_at IS NULL THEN 'active' ELSE 'inactive' END,1,deleted_at FROM users"), {"issuer": issuer})


def downgrade() -> None:
    if op.get_bind().execute(sa.text("SELECT count(*) FROM account_operations WHERE kind='delete'")).scalar_one():
        raise RuntimeError("Account deletion evidence must be retained")
    op.drop_table("account_deletion_objects")
    op.drop_table("account_operations")
    op.drop_table("account_authorities")
