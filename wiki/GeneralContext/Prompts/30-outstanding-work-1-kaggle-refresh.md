---
type: prompt
---

# 30 — Outstanding work, track 1: the automated Kaggle refresh (`EVENTS-008`)

**Brief for a Director session.** Shared rules: [29](29-outstanding-work.md).
Read them first.

**Objective:** the live database follows the Kaggle dataset with no manual
step. Today the human downloads the Eoin Moore dataset, uploads four CSVs to
`SportsDataBucket` and invokes `SportsDataLoad` by hand
(`build-deployment-post-deploy.md` "Load sports data"). The human's top
priority ([ADR 0035](../Decisions/0035-outstanding-work-answers.md)): the
download, the upload and the load run on a schedule. Closes the backlog row
"Automated refresh from Kaggle" and `Prompts/06` open work 2 and 3.

## Read first, in this order

1. `Prompts/06-nba-data.md`: "Decisions already made" and "Open work" 2. The
   dataset's quirks are there; the loader already handles them.
2. `wiki/CodeContext/Modules/0x02b-events-loading.md`: the loader and the
   `SportsDataLoad` function (15 min, 2048 MB, 1024 MB `/tmp`, an advisory
   lock, an event that must list its seasons).
3. `wiki/CodeContext/Standards/build-deployment-post-deploy.md` "Load sports
   data": the manual path this replaces, and its file names under `nba-eoin/`.
4. `backend/app/events/load_handler.py`, `infra/lib/app-stack.ts` (the
   `SportsDataLoad` function) and `infra/lib/storage-stack.ts` (the bucket).
5. `Architecture/deploy-traps.md`, and `0x00b` for IAM rules (no wildcards;
   `infra/test/iam-policy.test.ts` gates them).

## Where things stand (2026-11-17), verify, don't trust

- The loader and function exist and were run by hand. Nothing schedules them.
- The four files are about 440 MB; `/tmp` is 1024 MB, so a function that
  downloads all four and loads in one run fits, with little to spare.
- The human has a Kaggle snippet for the download (the Kaggle API or
  `kagglehub`); **ask the human to paste it** before you design the download.
- Egress to Kaggle goes through the NAT instance on 443, already allowed.
- Nobody has checked the dataset is still updating since 2026-10-25: do that
  first (the dataset page's version history), and report it.

## Deliverables

1. **The design (Director PR, then a spec).** Decide, with `AskUserQuestion`
   only where the docs leave a real choice:
   - one function that downloads from Kaggle into `/tmp` and calls the loader
     directly, or a download function that uploads to `SportsDataBucket` and
     then triggers the loader (the second keeps the bucket as the single input
     the manual path also uses, which is the simpler thing to keep working);
   - which seasons: the current season only, derived from the date, with a
     manual event still able to name any seasons;
   - schedule files (`LeagueSchedule<YY>_<YY>.csv`): where they come from;
   - what a failed or empty download does: fail loud, alarm, and never leave
     the database half-loaded (the loader's lock and single transaction help);
   - a corrected final score is reported, not applied silently (`Prompts/06`).
2. **The unit `EVENTS-008` (hand).** Test first. The Kaggle client is behind
   an interface so tests use a fake and never touch the network. IAM: read the
   token secret, write the bucket (the CMK needs `kms:GenerateDataKey`), no
   wildcards. An EventBridge schedule, daily, with an alarm on failure wired
   into the existing alarm topic (update `0x00a`, and the alarm count test).
3. **Documentation.** `0x02b` states the new flow; `post-deploy.md` keeps the
   manual path as the fallback; delete `Prompts/06`'s open work 2 and 3; the
   backlog row goes.

## What the human does (list it for them, in order)

1. Create a Kaggle API token (kaggle.com → Settings → API).
2. Store it in Secrets Manager under the name the spec gives, with a
   single-line PowerShell command that prompts for the value, so the key is
   never pasted into chat.
3. Approve the deploy; run the Migration Lambda only if the unit added an
   Alembic revision (it should not).
4. After the first scheduled run, check the games count with the API
   (`/api/events/teams` answers 200; the games list shows the newest game).

## Design notes (proposals, not decisions)

- Kaggle's per-file download avoids pulling the whole archive; confirm the
  four files and the schedule files can be fetched singly.
- A Lambda in the VPC reaches Kaggle only through the NAT. If the function
  needs the database, it already lives there; a download-only function could
  live outside the VPC and avoid the NAT, at the cost of a second function.
