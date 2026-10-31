#!/usr/bin/env python3
"""Trusted, isolated entrypoint for metrics data collection and publication."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agentlib import metricspublish


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise metricspublish.PublishError("invalid publication arguments")


def main():
    parser = _Parser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare")
    prepare.add_argument("--data-root", required=True, type=Path)
    prepare.add_argument("--remote", required=True)
    publish = commands.add_parser("publish")
    publish.add_argument("--data-root", required=True, type=Path)
    publish.add_argument("--records-dir", required=True, type=Path)
    collect = commands.add_parser("collect")
    collect.add_argument("--root", required=True, type=Path)
    collect.add_argument("--out-dir", required=True, type=Path)
    collect.add_argument("--repo", required=True)
    collect.add_argument("--event-name", required=True)
    collect.add_argument("--event-path", required=True, type=Path)
    collect.add_argument("--existing-root", type=Path)
    collect.add_argument("--limit", type=int, default=50)
    collect.add_argument("--scan-offset", type=int, default=0)
    try:
        args = parser.parse_args()
        if args.command == "prepare":
            metricspublish.prepare_store(args.data_root, args.remote)
        elif args.command == "publish":
            metricspublish.publish(
                args.data_root,
                args.records_dir,
                token=os.environ.get("METRICS_PUSH_TOKEN"),
            )
        else:
            payload = json.loads(args.event_path.read_text(encoding="utf-8"))
            tasks = metricspublish.collect_batch(
                args.root,
                args.out_dir,
                repo=args.repo,
                event_name=args.event_name,
                event=payload,
                existing_root=args.existing_root,
                limit=args.limit,
                scan_offset=args.scan_offset,
            )
            if os.environ.get("GITHUB_OUTPUT"):
                with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
                    output.write(f"has_records={'true' if tasks else 'false'}\n")
    except (metricspublish.PublishError, OSError, UnicodeError, ValueError, TypeError):
        print("metrics publication failed; source data withheld", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
