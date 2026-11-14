---
type: runbook
---

# Incident Runbook: roll back a deploy

Part of the [Incident Runbook](incident-runbook.md).

## Roll back a deploy

`deploy.yml` ends with **Smoke check the live site**: `/api/health`, `/api/feed?limit=1` (the first that
reaches the database) and the SPA root, through `https://fanwire.daviddems.com`, retried for about two
minutes. A red smoke check means the stacks deployed and the site does not answer as it should.

1. **Rule out the migration first.** If the commit adds an Alembic revision, the new code may be waiting for
   its schema: the usual sign is `/api/health` passing and `/api/feed?limit=1` answering 500. The deploy role
   cannot invoke the Migration function, so run these in order, in one PowerShell window (the same commands as
   `build-deployment-post-deploy.md` → "Run migrations"):
   1. Sign in:
      ```powershell
      aws sso login --profile fanwire-workload
      ```
   2. Find the function. `$migration` then prints a name containing `Migration`:
      ```powershell
      $migration = aws lambda list-functions --profile fanwire-workload --region ca-central-1 --query "Functions[?contains(FunctionName,'Migration')].FunctionName" --output text; $migration
      ```
   3. Invoke it. The answer must name the commit's new head revision, `{"revision": "<id>"}`:
      ```powershell
      aws lambda invoke --profile fanwire-workload --region ca-central-1 --function-name $migration "$env:TEMP\migrate.json"; Get-Content "$env:TEMP\migrate.json"
      ```
   4. Re-run the failed deploy run. It waits for the environment's reviewer again:
      ```powershell
      gh run rerun PASTE_RUN_ID --failed
      ```

   If it goes green, it was never a bad deploy.
2. **Otherwise, re-run the last good deploy.** A `workflow_dispatch` can't target an old commit. The
   `production` environment admits `main` only, so a dispatch either deploys `main`'s head again or is refused.
   Re-running an earlier *run* keeps that run's commit and its `main` ref, which the environment admits. List
   the recent green runs, then re-run the newest one older than the bad merge. It waits for the environment's
   reviewer like any deploy.

   ```powershell
   gh run list --workflow deploy.yml --status success --limit 5 --json databaseId,headSha,createdAt,displayTitle
   ```
   ```powershell
   gh run rerun PASTE_RUN_ID
   ```
3. **Revert on `main` straight away.** The next merge deploys `main`'s head, bad commit included. Open a PR that
   reverts the bad merge (`git revert -m 1 PASTE_MERGE_SHA` on a new branch) and merge it.

**What a rollback does not undo:** a migration that already ran. Alembic revisions are not reversed by an old
image, so the old code runs against the new schema. That is safe for an additive revision (a new table,
column or index), which is the only kind this repo writes. GitHub keeps a run re-runnable for 30 days; past
that, the revert in step 3 is the only way back.
