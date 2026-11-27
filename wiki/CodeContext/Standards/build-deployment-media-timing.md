---
type: runbook
---

# Timing the image pipeline (R16)

Measures, on the live stack, how long an attached image takes from upload to `processed`, and compares it with the composer's bound: one poll a second from the end of the bucket upload, refusal at 30 s (`CHECK_BOUND_MS`, `frontend/src/features/compose/MediaWidget.tsx`; [[wiki/CodeContext/Modules/0x08d-frontend-compose-modals|0x08d]]). The pipeline is [[wiki/CodeContext/Modules/0x04-media|0x04]]: presigned POST to the quarantine bucket, GuardDuty Malware Protection scan, EventBridge rule, `media-scan-results` queue, `Media` Lambda, public bucket. Everything here is read-only: browser timings, CloudWatch Logs reads and a clock check.

Segments, per upload:

| Segment | From | To | Source |
|---|---|---|---|
| A. Ticket and upload | `POST /api/media/uploads` starts | S3 POST ends (quarantine object exists) | browser |
| B. Scan and delivery | S3 POST ends | `Media` Lambda `START` | browser, Lambda log |
| C. Processing | `START` | `REPORT` (`Duration`, plus `Init Duration` on a cold start) | Lambda log |
| D. Client sees it | `REPORT` | the poll that answers `processed` ends | Lambda log, browser |
| Total | S3 POST ends | that poll ends | browser |

The scan verdict has no timestamp of its own that can be read afterwards: processing deletes the quarantine object and its tag, and the handler does not log the event. B is therefore GuardDuty's scan plus EventBridge and SQS delivery, together.

## Before you start

You need a browser signed in to `https://fanwire.daviddems.com`, a typical phone photo as a **JPEG of 2–4 MB** (HEIC is refused by type, anything over 5 MB by size), and a PowerShell window. Uploads are limited to 5 a minute per user, so leave at least 15 s between them; that also keeps each upload's log lines apart.

1. Sign the CLI in if its token has expired.
   ```powershell
   aws sso login --profile fanwire-workload
   ```
2. Measure this machine's clock offset against AWS's time service. Success: lines ending in an offset such as `+00.0123456s`; note it.
   ```powershell
   w32tm /stripchart /computer:time.aws.com /samples:3 /dataonly
   ```
3. Open the site, open DevTools (F12), Console tab. Chrome asks you to type `allow pasting` the first time. Raise the resource-timing buffer, so the feed's images cannot push the upload's entries out, and clear it:
   ```javascript
   performance.setResourceTimingBufferSize(5000); performance.clearResourceTimings();
   ```

## Five uploads

Make the first upload after the app has been idle for at least 15 minutes, so a cold start is in the sample. For each of the five:

1. Open compose (**+**), attach the photo, and wait until its thumbnail replaces the tile (or the red refusal line appears). Do not post; close compose and discard. An unattached media row is the normal case.
2. Paste this into the Console. It prints one JSON line and clears the buffer for the next upload. Copy the line.
   ```javascript
   (() => { const o = performance.timeOrigin, iso = (m) => new Date(o + m).toISOString(), e = performance.getEntriesByType('resource'), up = e.find((x) => /\/api\/media\/uploads(\?|$)/.test(x.name)), s3 = e.find((x) => /s3[.\-][a-z0-9.\-]*amazonaws\.com/.test(x.name)), p = e.filter((x) => /\/api\/media\/\d+(\?|$)/.test(x.name)), last = p[p.length - 1]; console.log(JSON.stringify({ media_id: last.name.split('?')[0].split('/').pop(), ticket_start: iso(up.startTime), upload_end: iso(s3.responseEnd), ready: iso(last.responseEnd), polls: p.length, a_ms: Math.round(s3.responseEnd - up.startTime), total_ms: Math.round(last.responseEnd - s3.responseEnd) })); performance.clearResourceTimings(); })()
   ```
   Success: a line with five distinct times and a `total_ms`. A `TypeError` means an entry is missing; reload, repeat step 3 of "Before you start", and upload again.
3. Wait at least 15 s before the next upload.

## The Lambda's side

Run these in one PowerShell window, within 30 minutes of the last upload (or widen `AddMinutes`).

1. Find the `Media` function's log group. CloudFormation names it, so look it up. `$mediaLog` then prints a name containing `MediaLogGroup`.
   ```powershell
   $mediaLog = aws cloudformation describe-stack-resources --profile fanwire-workload --region ca-central-1 --stack-name Fanwire-App --query "StackResources[?ResourceType=='AWS::Logs::LogGroup' && starts_with(LogicalResourceId,'MediaLogGroup')].PhysicalResourceId" --output text
   ```
2. Read the invocations' `START` and `REPORT` lines into a file and print it. Success: five `START` lines and five `REPORT` lines, each prefixed with its epoch-millisecond timestamp; a `REPORT` with `Init Duration` is the cold start.
   ```powershell
   $env:PYTHONIOENCODING='utf-8'; $env:PYTHONUTF8='1'; aws logs filter-log-events --profile fanwire-workload --region ca-central-1 --log-group-name $mediaLog --start-time ([DateTimeOffset]::UtcNow.AddMinutes(-30).ToUnixTimeMilliseconds()) --filter-pattern '?START ?REPORT' --query "events[].[timestamp,message]" --output text | Out-File -Encoding utf8 "$env:TEMP\r16-media.txt"; Get-Content "$env:TEMP\r16-media.txt"
   ```
3. Only if an upload was refused or fewer than five invocations appear: read the handler's errors for the same window.
   ```powershell
   $env:PYTHONIOENCODING='utf-8'; $env:PYTHONUTF8='1'; aws logs filter-log-events --profile fanwire-workload --region ca-central-1 --log-group-name $mediaLog --start-time ([DateTimeOffset]::UtcNow.AddMinutes(-30).ToUnixTimeMilliseconds()) --filter-pattern 'ERROR' --query "events[].[timestamp,message]" --output text | Out-File -Encoding utf8 "$env:TEMP\r16-media-errors.txt"; Get-Content "$env:TEMP\r16-media-errors.txt"
   ```

## Report

Paste into the Director session: the clock offset, the five Console lines in upload order, and the contents of `r16-media.txt` (and `r16-media-errors.txt` if step 3 ran). The Director matches each upload to its invocation by order and time, corrects the browser times by the offset, and works out p50 and max for A–D and the total.

The result is recorded in two places: the R16 line of [[wiki/CodeContext/Modules/0x08d-frontend-compose-modals|0x08d]] "Measured" (p50/max per segment, the cold start's total, and the margin against 30 s), and the removal of R16 from the Final track row of `TODO/02-backlog.md`. A total above 30 s, or any refusal at the bound, is a finding for the backlog, not a pass.
