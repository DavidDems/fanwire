# EVENTS-008: the automated Kaggle refresh

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

The human's top priority (ADR 0035): the live database follows the Eoin Moore
dataset with no manual step. Today the human downloads four CSVs, uploads them to
`SportsDataBucket` and invokes `SportsDataLoad` (`Standards/build-deployment-post-deploy.md`
"Load sports data"). This unit schedules all of it. Outstanding-work track 1
(`Prompts/30`).

## Decisions (the human, 2026-11-17)

1. **Split:** a download function writes to `SportsDataBucket`, then invokes the
   existing loader. The bucket stays the one input the manual path also uses.
2. **Seasons:** the current season from the date; a manual event can name any.
3. **Corrected score:** skip that game, report it, load the rest (changes the loader).
4. **Secret:** CDK creates `fanwire/kaggle-api-token` with a placeholder; the human
   overwrites it. Exact ARN, so no IAM wildcard.

## What was verified on 2026-11-17

- The dataset page: Version 551, "Updated 4 hours ago", `Games.csv` through 2026-11-16,
  CC0, daily. The author says nightly uploads are flaky and a whole-dataset download is
  hit or miss, but **single files always work**. The version-history page is not
  readable without a login, so no per-version dates.
- Single files exist: `Games.csv`, `PlayerStatistics.csv`, `TeamStatistics.csv`,
  `Players.csv`, `LeagueSchedule24_25.csv`, `LeagueSchedule25_26.csv`,
  `LeagueSchedule26_27.csv`. The whole dataset is 1.87 GB; we fetch ~440 MB.
- kagglehub 1.0.3 (2026-10-21) README: `KAGGLE_API_TOKEN`, `~/.kaggle/access_token`,
  `kagglehub.login()` (interactive, unusable here) or legacy `kaggle.json`.
  `dataset_download(handle, path=<file>)` downloads a single file. The lookup order and
  the `KGAT_` prefix are not documented; the first scheduled run is the real check.
  1.0.3's changelog mentions single files arriving in a server-side zip wrapper, so peak
  `/tmp` may be double the largest file: 2048 MB of ephemeral storage, one file at a time.

## Things the unit must not get wrong

- **The bucket is unversioned**, and the manual path reads the same keys. A truncated
  or wrong download overwrites the last good copy. The header/size guard is a
  correctness criterion, not polish.
- **The download function is outside the VPC**: no NAT, no database. `backendFunction`
  forces a VPC today; the option for none must leave every existing template unchanged.
- **Async invoke of the loader**, with no retry. The loader's advisory lock and the next
  day's run are the recovery.
- **The token never touches configuration, logs, exceptions or disk.** Read at
  invocation, set in `os.environ` only.
- **Alarms are mostly derived:** every Lambda in the stack gets Errors and Throttles.
  Count the new ones from the value on `main`, not from this brief.

## Accepted limits (say them in the PR)

- Kaggle may update between the four per-file downloads. The loader tolerates it and
  the next run completes it.
- A season's schedule published in July to September is picked up from 1 October.
- A conflicting score stays stored as it was and the alarm persists until the human
  decides. If the unit finds no resolution path, it says so in 0x02b; it adds none.

## After the unit (Director follow-up PRs, not unit-writable)

`Standards/build-deployment-post-deploy.md` (the manual path becomes the fallback and the
token step is added), `TODO/01-for-you.md` and `TODO/02-backlog.md` (the row goes),
`Prompts/06` open work 2 and 3, `Prompts/30` and the table in `Prompts/29`, and one
`Timeline/` line.
