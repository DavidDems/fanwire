# 08 — What the post-deploy checklist turned up

**Objective:** three small, independent units that `05` found while checking
the live site. None blocks anything; each is its own branch and its own PR, in
any order. Run `07` first if you are choosing — it is the larger risk.

**Read:** `00-session-protocol.md`, then
`wiki/CodeContext/Modules/0x00-architecture.md` → "Post-deploy checks,
2026-09-30" for where each came from. Everything goes through the ordinary
loop: failing test committed alone, then the implementation, then the wiki.

## 1. `lambda-vpc-eni`: stop the function code using its own ENI permissions

The review is done and its answer is in `0x00` → the `lambda-vpc-eni` waiver:
the VPC attachment is unavoidable for all five functions, and `Resource "*"`
is AWS's documented floor. What AWS recommends instead is a `Deny` on the same
EC2 actions conditioned on `lambda:SourceFunctionArn`. That key is present
only on calls the function's *code* makes, so Lambda can still manage the ENIs
while the code cannot.

- Add it to `backendFunction` in `infra/lib/app-stack.ts`, alongside the
  `VpcNetworkInterfaces` allow. Use `ArnLike` on
  `arn:aws:lambda:<region>:<account>:function:Fanwire-App-*`: a per-function
  ARN would make the policy depend on the function, which already depends on
  the policy.
- The IAM gate (`infra/test/iam-policy.test.ts`) will see a `Deny` with
  `Resource "*"`. Check whether its rules treat a Deny differently before
  adding a waiver, and if a waiver is needed, say why in its comment.
- **Not proven until deployed.** Lambda checks the ENI permissions at
  `CreateFunction`/`UpdateFunctionConfiguration`, so the observable is a
  `cdk deploy Fanwire-App` that succeeds, followed by a logged-in
  `/api/users/me` on the live site. Say so in the PR; the human deploys.

## 2. Compose with media: drop the separate *Attach* click

Today, attaching an image is: upload → wait for the scan → click *Attach*. It
works (verified live 2026-09-30) and the human called it "a bit annoying, this
can be changed later". The goal is that a successfully processed upload is
attached without the extra click, and that a rejected or failed one says so.

- Start at `frontend/src/features/compose/MediaWidget.tsx` and
  `ComposePage.tsx`, and `wiki/CodeContext/Modules/0x08-frontend.md`.
- The scan is asynchronous (GuardDuty → queue → media Lambda), so the widget
  must still wait for `Processed`. Only the click goes away, not the wait.
- Rebuild and re-upload the bundle afterwards with
  `wiki/CodeContext/Standards/build-deployment.md` → "Rebuilding the SPA".

## 3. A DLQ-depth alarm

Every queue has a DLQ, and nothing watches them. The notifications bug `05`
found would have surfaced as DLQ messages within 15 minutes, had anyone been
looking. The runbook lists this as a known gap.

- One CloudWatch alarm per DLQ on `ApproximateNumberOfMessagesVisible > 0`,
  in `infra/lib/messaging-stack.ts`.
- **Where it notifies is a human decision** (SNS → email costs nothing at this
  volume, but it is an address and a subscription confirmation). Ask before
  building the notification half; the alarm itself is useful in the console
  without it.

Nothing here has merge permission. One PR per unit. Merge nothing.
