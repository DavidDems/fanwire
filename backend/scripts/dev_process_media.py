"""Dev-only stand-in for the GuardDuty verdict that app.media.lambda_handler
normally waits for (MEDIA-002).

Locally there is no GuardDuty wired up (wiki/CodeContext/Modules/
0x04-media.md "AWS service mapping" — the scan verdict is a GuardDuty
finding, not something this repo's local stack produces), so a `Media` row
created by the real presigned-POST route (`POST /media/uploads`) sits in
`Uploaded` forever: nothing ever delivers the "GuardDuty Malware Protection
Object Scan Result" event app.media.lambda_handler.handler waits for, and
the image can never be attached to a post. Running this script against that
row's id drives it to `Processed` so the compose-with-media flow can be
clicked through in a browser.

It does this by constructing and running the real
`app.media.pipeline.ImageUploadPipeline` — the same Template Method
app.media.lambda_handler.handler drives on the real `NO_THREATS_FOUND`
path — fed a `GuardDutyScanResultScanner` exactly as that handler does, so
the fields recorded on `Media` and the objects written to S3 are identical
to the real path's. It never sets `.status` itself (see app.media.state's
docstring on why `transition()` is the only legal way to move `.status`).

Fail-closed by design: refuses to run unless `ENVIRONMENT` is exactly
`"development"`, so it can never be pointed at a deployed environment by
accident.

Usage (inside the backend-dev container, or locally with DATABASE_URL set
to point at the compose Postgres):
    python scripts/dev_process_media.py <media_id>
"""

from __future__ import annotations

import sys
from pathlib import Path

# scripts/ has no __init__.py (same as scripts/export_openapi.py) -- Python's
# implicit namespace package support picks it up once BACKEND_ROOT is on
# sys.path, inserted the same defensive way export_openapi.py inserts it for
# its own `from app.main import app`.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import os

from app.dependencies import get_settings, open_session
from app.media.dependencies import get_s3_client
from app.media.models import Media, MediaStatus
from app.media.pipeline import GuardDutyScanResultScanner, ImageUploadPipeline

REQUIRED_ENVIRONMENT = "development"


def main(argv: list[str]) -> int:
    environment = os.environ.get("ENVIRONMENT")
    if environment != REQUIRED_ENVIRONMENT:
        print(
            f"refusing to run: ENVIRONMENT={environment!r}, but this script only ever "
            f"runs in a {REQUIRED_ENVIRONMENT!r} environment -- it stands in for a "
            "GuardDuty verdict that must never be faked anywhere real"
        )
        return 1

    if not argv:
        print("usage: dev_process_media.py <media_id>")
        return 2

    try:
        media_id = int(argv[0])
    except ValueError:
        print(f"not a valid media id: {argv[0]!r}")
        return 2

    settings = get_settings()
    s3_client = get_s3_client()
    session = open_session()
    try:
        media = session.get(Media, media_id)
        if media is None:
            print(f"no Media row with id {media_id}")
            return 1

        if media.status == MediaStatus.PROCESSED:
            print(f"Media {media_id} is already Processed -- nothing to do")
            return 0

        if media.status != MediaStatus.UPLOADED:
            print(
                f"Media {media_id} is {media.status.value}, not Uploaded -- this script "
                "only stands in for the verdict on a freshly-uploaded object"
            )
            return 1

        pipeline = ImageUploadPipeline(
            media,
            session,
            s3_client,
            GuardDutyScanResultScanner(),
            quarantine_bucket=settings.media_quarantine_bucket,
            public_bucket=settings.media_public_bucket,
        )
        pipeline.run()
        print(f"Media {media_id} moved to {media.status.value}")
        return 0
    finally:
        session.close()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
