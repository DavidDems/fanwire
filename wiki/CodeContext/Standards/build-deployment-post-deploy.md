---
type: runbook
---

# After a deploy: migrations and sports data

The deploy workflow runs neither of these ([[wiki/CodeContext/Standards/build-deployment|Build & Deployment]] "Automated deploy" → "What it does not do"). The human runs them by hand.

## Run migrations

When: after a deploy that adds an Alembic revision. Run these in order, in one PowerShell window:

1. Find the function:
   ```powershell
   $migration = aws lambda list-functions --profile fanwire-workload --region ca-central-1 --query "Functions[?contains(FunctionName,'Migration')].FunctionName" --output text
   ```
2. Invoke it and print its answer, which must name the new head revision:
   ```powershell
   aws lambda invoke --profile fanwire-workload --region ca-central-1 --function-name $migration "$env:TEMP\migrate.json"; Get-Content "$env:TEMP\migrate.json"
   ```

Success: the answer names the new head revision.

## Load sports data

Nothing invokes `SportsDataLoad` (`EVENTS-002`), by design, like `Migration`. The human loads the live database after a deploy, from one PowerShell window, because later steps use the variables earlier ones set. Run the steps in order:

1. Find the bucket. `$bucket` then prints its name.
   ```powershell
   $bucket = aws cloudformation describe-stacks --profile fanwire-workload --region ca-central-1 --stack-name Fanwire-Storage --query "Stacks[0].Outputs[?OutputKey=='SportsDataBucketName'].OutputValue" --output text
   ```
2. Upload the four files the loader reads (about 440 MB) under `nba-eoin/`. The bucket encrypts with the CMK, so the upload needs `kms:GenerateDataKey` on it as well as `s3:PutObject`. An `AccessDenied` that names KMS means the profile lacks it.
   ```powershell
   foreach ($f in 'Games.csv','PlayerStatistics.csv','TeamStatistics.csv','Players.csv') { aws s3 cp "C:\data\nba\$f" "s3://$bucket/nba-eoin/$f" --profile fanwire-workload --region ca-central-1 }
   ```
   Also upload the current season's schedule, `LeagueSchedule<YY>_<YY>.csv` (`EVENTS-014`). The load reads it for each season in the event; a missing file leaves that season's stored schedule as it was. Upload only files in the 2025-26 / 2026-27 header shape: `LeagueSchedule24_25.csv` fails the load as a `DatasetError`. For 2026-27:
   ```powershell
   aws s3 cp "C:\data\nba-refresh\LeagueSchedule26_27.csv" "s3://$bucket/nba-eoin/LeagueSchedule26_27.csv" --profile fanwire-workload --region ca-central-1
   ```
3. Find the function. `$fn` then prints a name containing `SportsDataLoad`.
   ```powershell
   $fn = aws lambda list-functions --profile fanwire-workload --region ca-central-1 --query "Functions[?contains(FunctionName,'SportsDataLoad')].FunctionName" --output text
   ```
4. Write the event to a file. PowerShell 5.1 strips the double quotes from a JSON argument passed to `aws`, so the event never goes on the command line. Start with one season:
   ```powershell
   Set-Content -Encoding ascii -Path "$env:TEMP\load.json" -Value '{"seasons":["2025-26"]}'
   ```
5. Invoke it, with a read timeout above the function's 15 minutes. The CLI's default is 60 s, and on a timeout it retries the invoke. The function's advisory lock refuses that second load, but the first one's report is lost.
   ```powershell
   aws lambda invoke --profile fanwire-workload --region ca-central-1 --function-name $fn --payload "fileb://$env:TEMP\load.json" --cli-read-timeout 900 --cli-connect-timeout 60 "$env:TEMP\load-report.json"; Get-Content "$env:TEMP\load-report.json"
   ```
6. Read the result. If the CLI's output shows `"FunctionError": "Unhandled"`, the load did not happen and the database is unchanged. The report file then holds the redacted reason. A `SportsDataLoadLocked` error means another load is still running; wait for it and look again. On success, the report's `lines` give one line per season (games loaded, skipped and named). Note how long the season took, from the function's log or the invoke's wall time.
7. Load the other 22 seasons in one invocation (measured locally at 73–139 s for all 23 seasons). Write the event, then repeat step 5.
   ```powershell
   Set-Content -Encoding ascii -Path "$env:TEMP\load.json" -Value (@{ seasons = @(2003..2024 | ForEach-Object { '{0}-{1:D2}' -f $_, (($_ + 1) % 100) }) } | ConvertTo-Json -Compress)
   ```
8. Check the site. This prints the newest game.
   ```powershell
   curl.exe -s "https://fanwire.daviddems.com/api/events/games?limit=1"
   ```

The function is re-runnable. A season already loaded reports its games as "already present" and writes nothing again. A new dataset version is uploaded over the same keys (step 2) and loaded the same way: only games not yet stored are added, so step 4's event names just the seasons that gained games. The human's copy of the four files is `C:\data\nba`.
