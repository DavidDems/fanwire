"""Permanent account removal: external objects, one database commit, identity last."""

from __future__ import annotations

from typing import Any

from aws_lambda_powertools import Logger
from botocore.exceptions import ClientError  # type: ignore[import-untyped]
from sqlalchemy.orm import Session

from app.media.dependencies import get_s3_client
from app.media.service import account_media_objects, remove_account_media
from app.notifications.service import remove_account_notifications
from app.posts.service import account_post_ids, remove_account_posts
from app.users.dependencies import get_cognito_client
from app.users.service import clear_account_picture, deletion_account_id, remove_account_user

logger = Logger()


def delete_account_data(
    session: Session,
    *,
    cognito_sub: str,
    s3_client: Any = None,
    cognito_client: Any = None,
    user_pool_id: str,
    quarantine_bucket: str,
    public_bucket: str,
) -> None:
    """Retryable deletion; individual module functions never commit.

    A missing local profile skips straight to Cognito, including after a
    previous attempt committed locally but failed to delete the identity.
    Exceptions are deliberately not logged here: SDK/SQL exceptions may carry PII.
    """
    user_id = deletion_account_id(session, cognito_sub)
    if user_id is not None:
        try:
            post_ids = account_post_ids(session, user_id)
            objects = account_media_objects(session, user_id, post_ids)
            for bucket, keys in (
                (quarantine_bucket, objects[0]),
                (public_bucket, objects[1]),
            ):
                for offset in range(0, len(keys), 1000):
                    if s3_client is None:
                        s3_client = get_s3_client()
                    result = s3_client.delete_objects(
                        Bucket=bucket,
                        Delete={"Objects": [{"Key": key} for key in keys[offset : offset + 1000]]},
                    )
                    if result.get("Errors"):
                        raise RuntimeError("Account media deletion failed")

            clear_account_picture(session, user_id)
            remove_account_notifications(session, user_id, post_ids)
            remove_account_media(session, user_id, post_ids)
            remove_account_posts(session, user_id, post_ids)
            remove_account_user(session, user_id)
            session.commit()
            logger.info(
                "account data removed",
                extra={
                    "user_id": user_id,
                    "post_count": len(post_ids),
                    "object_count": len(objects[0]) + len(objects[1]),
                },
            )
        except Exception:
            session.rollback()
            raise

    try:
        if cognito_client is None:
            cognito_client = get_cognito_client()
        cognito_client.admin_delete_user(UserPoolId=user_pool_id, Username=cognito_sub)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") != "UserNotFoundException":
            raise
