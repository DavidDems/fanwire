---
type: reference
---

# Documentation lint

`agentlib.doclint` is a stdlib-only, offline check run by the always-on
`docs-lint` job in `test-agent.yml`, required by `gate`. Its document types,
body-word counting and budgets come from the
[WikiUpdate skill](../../.claude/skills/wiki-update/SKILL.md).

The scan reads tracked working-tree files, including staged new files. It
does not read untracked files, download links or rewrite documents. A link
cannot be satisfied by a file present only in a developer's local checkout.
Type, budget, reference-history and duplicate checks apply to Markdown under
`wiki/` and `.ai/docs/`. Link checks apply to tracked Markdown throughout the
repository. Citation checks also cover tracked Python, JSON, YAML, TypeScript,
TSX, text, PowerShell, shell and TOML files. Python citations are extracted
from comments and actual docstrings, avoiding fixture string literals. Files
under `.ai/tests/fixtures/` are frozen copies of documents that tests rebuild,
dead links included: they remain link targets, but their own links and
citations are not checked
([ADR 0034](../../wiki/GeneralContext/Decisions/0034-doclint-skips-test-fixtures.md)).

Opening frontmatter uses a deliberately small YAML subset: unique scalar
`key: value` fields, optional quoted values, blank lines and comments,
between two standalone `---` lines. Exactly one recognized `type` is required.
Multiline values, duplicate keys and other YAML constructs fail validation.
Budgets count whitespace tokens in the body, including code and tables.

Markdown links include inline links/images with balanced parentheses or
angle-delimited destinations, full/collapsed reference links and definitions,
and repository wikilinks with optional aliases and extensionless Markdown
paths. Reference links resolve through their definitions; undefined bracket
expressions are plain text, as in Markdown. Fenced examples and inline-code examples are not
links; inline-code citations remain checked. Ordinary URLs and mail links are
ignored. Paths are URL-decoded, confined to the repository, document-relative
unless they start with a repository directory or `/`. Wiki table separators
may escape the alias separator. Fragments use heading slugs (ATX or setext,
including repeated-heading suffixes), HTML id/name attributes or GitHub line
fragments. External URLs are never fetched. This is a bounded syntax checker,
not a complete CommonMark renderer or a semantic fact checker.

Explicit file-and-line citations validate positive line numbers and ranges
against the target. File-and-section citations validate the exact numbered
heading, with an optional section symbol in the heading itself and optional
letter suffixes. A shorthand path may resolve through a unique tracked suffix;
ambiguous names fail. A bare section refers to the current file unless preceded
by an unambiguous Markdown filename stem naming another document.

References reject lines containing dated Status/Update notes, temporal qualifiers,
Status/Current status headings or labelled status blocks, outside fenced examples. Duplicate detection
compares every contiguous 40-token body window, case-folded with whitespace
collapsed, including code/tables. Each matching file pair and window has a
stable SHA-256 fingerprint. Punctuation remains significant; no model decides
whether two paraphrases mean the same thing. Apart from test fixtures and
merged decisions, there are no corpus-specific exclusions or size-budget
guesses for untyped legacy files.

Merged decisions are compared with the supplied base. Removing or renaming a
decision also fails. After line-ending normalization, the entire file must
remain identical except for its `superseded_by:` frontmatter line. That value
must resolve to a different typed decision. Legacy untyped decision collections
remain migration debt; they are not silently relabelled.

`.ai/docs-baseline.json` is a sorted, unique JSON array of violation keys.
Each key identifies the source path, rule and detail, without source line
positions. The scan must be a subset of this array: new debt fails, while fixed
debt may leave an unused entry. Unit PRs can therefore clear debt without
editing the baseline under `.ai/`, which remains forbidden to every worker.
Directors can prune unused entries in a separate maintenance PR; until pruned,
an entry still permits that exact violation to recur. The current array must
also be a subset of the base commit's array. Changing an exception's identity counts as adding
one. CI supplies the PR base SHA, push-before SHA, or `origin/main` for manual
runs. Missing history, malformed baselines and missing rule sources fail
closed. Only initial introduction against a base containing neither linter
nor baseline can establish the initial debt inventory. Once the linter exists,
a missing base baseline cannot reset the inventory. Director review controls
changes to the checker itself, as it controls the rest of `.ai/`.

1. From the repository root, check the change against main:

   ```powershell
   python .ai/bin/agentctl.py docs lint --base origin/main
   ```

2. To inspect individual violation keys and ratchet errors, request JSON:

   ```powershell
   python .ai/bin/agentctl.py docs lint --base origin/main --json
   ```

3. For a migration, fix documents and their inbound citations, stage any new
   files, then rerun step 1. No baseline edit is needed in a unit PR. A Director
   maintenance PR may also delete fixed entries to retire those exceptions.

A pass reports baselined debt and zero errors; it does not claim zero debt.
Exit codes are 0 for a satisfied ratchet, 1 for violations of the ratchet,
and 2 for invalid inputs or unavailable files/history. Maintenance scheduling
and corpus migration are separate Prompt 10 deliverables.

## Corpus tools

`agentlib.doccorpus` adds three `docs` subcommands for the
[Context-Update-Track](../../wiki/GeneralContext/Prompts/25-context-update-track.md).
They share the linter's types, budgets, body count and link syntax, read
tracked files only, and exit 0 unless their input is unusable (2). Each takes
`--paths <prefix>...` to narrow its scope, `--root <repo>` to read another
checkout, and `--json`.

- `docs inventory` gives one row per tracked Markdown file: body words, type,
  budget and whether it is over, the newest commit that touched it, and every
  inbound source. A source is a `link` when a Markdown link resolves to the
  file, or a `mention` when any tracked text file names its repository path,
  such as a spec's `required_context`. `-v` lists the sources.
- `docs dupes` splits bodies into blank-line paragraphs, with fenced code
  removed. It drops Markdown emphasis, list markers and link destinations,
  case-folds, and skips paragraphs under `--min-words` (12). Exact repeats
  are grouped by a hash of the result. Near repeats pair distinct paragraphs
  whose word-trigram Jaccard similarity is at least `--threshold` (0.8). A
  trigram shared by more than 50 paragraphs is ignored as boilerplate.
- `docs archive-refs` rewrites tracked Markdown, and nothing else, for the
  move to a new repository. `#N` becomes `fanwire-archive#N`. A hex word of 7
  to 40 characters becomes `fanwire-archive@<hash>`, but only when git
  resolves it to a commit, so migration revisions and AWS ids stay as they
  are. `github.com/<owner>/fanwire/` pull, issue, commit and compare URLs
  move to `fanwire-archive`. Fenced code is left alone. Link destinations and
  bare URLs are changed only by the URL rule. Without `--write` it prints each
  changed line and writes nothing. With it, line endings are kept, and a
  second run finds nothing to change. Any `#N` counts as a PR number, local
  numbering included, so read the dry run before writing. A merged decision
  it touches fails `decision-changed` against a base that has the original,
  so it runs only on the cutover snapshot.
