"""Deterministic core of the fanwire agent system.

Stdlib only, on purpose: this package is the security and correctness boundary
around every LLM worker, so it must be runnable by any orchestrator step
without an install, a lockfile, or a third-party parser. See
`.ai/docs/architecture.md`.
"""

__all__ = ["ciresult", "guard", "orchestrator", "spec", "state", "telemetry"]
