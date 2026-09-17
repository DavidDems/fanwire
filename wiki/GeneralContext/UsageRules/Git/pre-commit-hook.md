# Pre-commit hook

## MUST NOT
- Commit code that hasn't passed lint/format — the pre-commit hook runs before any commit reaches an agent's context; do not disable it or commit with `--no-verify` to skip it.
- Treat a pre-commit failure as something to work around — fix the underlying lint/format issue, then commit again.
