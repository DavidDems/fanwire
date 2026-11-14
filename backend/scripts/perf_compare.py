"""Compares a local load-test run with the previous one on the same machine
(PERF-001, perf/README.md).

Reads two k6 `handleSummary` JSON files: the run perf/run.ps1 just made, and
the stored baseline for the same profile. The endpoints are the `endpoint`
tag values of the `http_req_duration{endpoint:<name>}` submetrics k6 writes
for every per-endpoint threshold; the untagged `http_req_duration` and every
other metric are ignored. For each baseline endpoint it prints p(95) and
p(99) side by side and the change in percent.

It fails (exit 1) when any endpoint's p(95) or p(99) is more than
`--max-regression` percent (default 20) slower than the baseline, or when an
endpoint in the baseline is missing from the run (a renamed or dropped
scenario must not pass silently). An endpoint new in the run is reported and
passes. With no baseline file it stores the run as the baseline and exits 0;
an existing baseline is never overwritten (delete it to re-baseline).

A local number measures the application and database code paths, not
production latency, which is why it is only ever compared with the same
machine's previous run, never with a production target.

Standard library only, so it needs nothing k6 or the app provides.

Usage (perf/run.ps1 runs it in the backend-perf image):
    python scripts/perf_compare.py --run summary-smoke.json \\
        --baseline baseline-smoke.json [--max-regression 20]
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

_ENDPOINT_METRIC = re.compile(r"^http_req_duration\{endpoint:([^}]+)\}$")
_STATS = ("p(95)", "p(99)")


def _endpoints(summary: dict) -> dict[str, dict[str, float]]:
    found: dict[str, dict[str, float]] = {}
    for name, metric in summary.get("metrics", {}).items():
        match = _ENDPOINT_METRIC.match(name)
        if match is None:
            continue
        values = metric.get("values", {})
        found[match.group(1)] = {stat: float(values[stat]) for stat in _STATS if stat in values}
    return found


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _change(base: float, now: float) -> float:
    if base <= 0:
        return 0.0 if now <= 0 else float("inf")
    return (now - base) / base * 100


def compare(run: dict, baseline: dict, max_regression: float) -> tuple[list[str], list[str]]:
    """Return (table lines, failures)."""
    run_endpoints = _endpoints(run)
    base_endpoints = _endpoints(baseline)
    lines = [
        f"{'endpoint':<18} {'stat':<6} {'baseline ms':>12} {'run ms':>10} {'change':>9}  result"
    ]
    failures: list[str] = []
    for endpoint in sorted(base_endpoints):
        if endpoint not in run_endpoints:
            lines.append(f"{endpoint:<18} {'-':<6} {'':>12} {'missing':>10} {'':>9}  FAIL")
            failures.append(f"{endpoint}: in the baseline but missing from the run")
            continue
        for stat in _STATS:
            base = base_endpoints[endpoint].get(stat)
            now = run_endpoints[endpoint].get(stat)
            if base is None or now is None:
                lines.append(f"{endpoint:<18} {stat:<6} {'':>12} {'n/a':>10} {'':>9}  FAIL")
                failures.append(f"{endpoint} {stat}: missing from the run or the baseline")
                continue
            change = _change(base, now)
            regressed = change > max_regression
            lines.append(
                f"{endpoint:<18} {stat:<6} {base:>12.2f} {now:>10.2f} {change:>+8.1f}%  "
                f"{'FAIL' if regressed else 'ok'}"
            )
            if regressed:
                failures.append(
                    f"{endpoint} {stat}: {base:.2f} ms -> {now:.2f} ms "
                    f"({change:+.1f}%, limit +{max_regression:g}%)"
                )
    for endpoint in sorted(set(run_endpoints) - set(base_endpoints)):
        lines.append(f"{endpoint:<18} {'-':<6} {'':>12} {'new':>10} {'':>9}  ok")
    return lines, failures


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Compare a k6 summary with a baseline.")
    parser.add_argument("--run", type=Path, required=True, help="this run's summary JSON")
    parser.add_argument("--baseline", type=Path, required=True, help="the baseline summary JSON")
    parser.add_argument(
        "--max-regression",
        type=float,
        default=20.0,
        help="largest allowed p95/p99 slowdown, in percent (default 20)",
    )
    args = parser.parse_args(argv)

    run = _load(args.run)
    if not args.baseline.is_file():
        args.baseline.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(args.run, args.baseline)
        print(f"no baseline at {args.baseline}: stored this run as the baseline")
        for endpoint, stats in sorted(_endpoints(run).items()):
            shown = "  ".join(f"{stat} {value:.2f} ms" for stat, value in stats.items())
            print(f"  {endpoint:<18} {shown}")
        return 0

    lines, failures = compare(run, _load(args.baseline), args.max_regression)
    print("\n".join(lines))
    if failures:
        print(f"\nREGRESSION (limit +{args.max_regression:g}%):")
        for failure in failures:
            print(f"  {failure}")
        return 1
    print(f"\nno endpoint regressed by more than {args.max_regression:g}%")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
