---
type: runbook
---

# Repository cutover: `fanwire` → a fresh public `fanwire`

**Human-facing.** CUT-12 of [Prompt 25](../Prompts/25-context-update-track.md),
run by the human with a Director. The old repository becomes
a private `fanwire-archive`; a new public `fanwire` starts from one commit.
Run the steps in order in one PowerShell window, so `$sha` and `$repoId`
stay set, and go on only when each check passes. The old checkout is
`C:\Users\david\source\repos\fanwire`; the new one, `fanwire-new` beside it.

## 1. Freeze

1. Close every open pull request (Renovate reopens them: step 9).
   ```powershell
   gh pr list --repo DavidDems/fanwire --state open
   ```
   ```powershell
   gh pr close 244 --repo DavidDems/fanwire --comment "Closed for the repository cutover; Renovate reopens it in the new repository."
   ```
   ```powershell
   gh pr close 293 --repo DavidDems/fanwire --comment "Closed for the repository cutover; Renovate reopens it in the new repository."
   ```
   Check: the list command prints nothing.
2. Confirm no workflow is running or waiting for a reviewer.
   ```powershell
   gh run list --repo DavidDems/fanwire --status in_progress; gh run list --repo DavidDems/fanwire --status waiting
   ```
   Check: it prints nothing; settle any waiting deploy first.
3. Bring the old checkout up to date on `main` and record the SHA.
   ```powershell
   git -C C:\Users\david\source\repos\fanwire switch main; git -C C:\Users\david\source\repos\fanwire pull --ff-only
   ```
   ```powershell
   $sha = git -C C:\Users\david\source\repos\fanwire rev-parse origin/main; $sha
   ```
   Check: the printed SHA matches `main` on GitHub's front page, and
   `git -C C:\Users\david\source\repos\fanwire status --porcelain` prints nothing.
4. At <https://github.com/settings/emails>, tick **Keep my email addresses
   private** and **Block command line pushes that expose my email**.
   Check: both boxes show ticked after a page reload.

## 2. Snapshot

1. Build the tree (what it keeps, drops and rewrites: the script's docstring).
   ```powershell
   python C:\Users\david\source\repos\fanwire\.ai\bin\cutover_snapshot.py --repo C:\Users\david\source\repos\fanwire --ref origin/main --expect-sha $sha --target C:\Users\david\source\repos\fanwire-new
   ```
   Check: exit code 0. The manifest's first line is `commit <$sha>`. Every
   `kept` task is one that `python .ai/bin/agentctl.py status` shows as not
   `COMPLETE`, `CANCELLED` or `FAILED`.
2. Make the single commit, as the noreply author.
   ```powershell
   git -C C:\Users\david\source\repos\fanwire-new init -b main; git -C C:\Users\david\source\repos\fanwire-new add -A
   ```
   ```powershell
   git -C C:\Users\david\source\repos\fanwire-new -c user.name=DavidDems -c user.email=71515505+DavidDems@users.noreply.github.com commit -q -m "fanwire: public snapshot of fanwire-archive@$sha"
   ```
   ```powershell
   git -C C:\Users\david\source\repos\fanwire-new log --format="%an <%ae> | %cn <%ce>"
   ```
   Check: one line, with the noreply address twice, and
   `git -C C:\Users\david\source\repos\fanwire-new rev-list --count HEAD` prints `1`.
3. Lint the snapshot locally.
   ```powershell
   python C:\Users\david\source\repos\fanwire-new\.ai\bin\agentctl.py docs lint --base HEAD; python C:\Users\david\source\repos\fanwire-new\.ai\bin\agentctl.py addresses
   ```
   Check: `docs lint: 0 baselined violations, 0 errors` and
   `addresses: 0 personal addresses` (lint exits 0 on errors: read the line).

## 3. Rename the old repository

```powershell
gh repo rename fanwire-archive --repo DavidDems/fanwire --yes
```
```powershell
gh api repos/DavidDems/fanwire-archive --jq .id
```
Check: this prints `1373722771`.
Re-point the old checkout at once: once the new `fanwire` exists, the old
URL reaches it.
```powershell
git -C C:\Users\david\source\repos\fanwire remote set-url origin https://github.com/DavidDems/fanwire-archive.git
```
Check: `git -C C:\Users\david\source\repos\fanwire remote -v` names `fanwire-archive` on both lines.

## 4. Create the new repository and its pre-push settings

The first push starts workflows, `deploy.yml` among them, so these come first.

1. Create it, empty, and record its id.
   ```powershell
   gh repo create DavidDems/fanwire --public
   ```
   ```powershell
   $repoId = gh api repos/DavidDems/fanwire --jq .id; $repoId
   ```
   Check: a number other than `1373722771`. `gh api repos/DavidDems/fanwire --jq .visibility` prints `public`.
2. Actions: selected actions only, SHA pins required.
   ```powershell
   gh api -X PUT repos/DavidDems/fanwire/actions/permissions -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true
   ```
   ```powershell
   gh api -X PUT repos/DavidDems/fanwire/actions/permissions/selected-actions -F github_owned_allowed=false -F verified_allowed=false -f "patterns_allowed[]=actions/*" -f "patterns_allowed[]=aws-actions/*" -f "patterns_allowed[]=docker/*" -f "patterns_allowed[]=github/*" -f "patterns_allowed[]=ossf/*"
   ```
   Check: the first prints `"allowed_actions":"selected"` and `"sha_pinning_required":true`. The second lists the five patterns, with both booleans `false`.
   ```powershell
   gh api repos/DavidDems/fanwire/actions/permissions; gh api repos/DavidDems/fanwire/actions/permissions/selected-actions
   ```
3. Workflow token read-only; Actions may open PRs; every outside contributor's fork PR waits for approval.
   ```powershell
   gh api -X PUT repos/DavidDems/fanwire/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true
   ```
   ```powershell
   gh api -X PUT repos/DavidDems/fanwire/actions/permissions/fork-pr-contributor-approval -f approval_policy=all_external_contributors
   ```
   Check: `"default_workflow_permissions":"read"`, `"can_approve_pull_request_reviews":true`, `"approval_policy":"all_external_contributors"`.
   ```powershell
   gh api repos/DavidDems/fanwire/actions/permissions/workflow; gh api repos/DavidDems/fanwire/actions/permissions/fork-pr-contributor-approval
   ```
4. The immutable OIDC subject.
   ```powershell
   gh api -X PUT repos/DavidDems/fanwire/actions/oidc/customization/sub -F use_default=true -F use_immutable_subject=true
   ```
   Check: `"use_immutable_subject":true` and a `sub_claim_prefix` of
   `repo:DavidDems@71515505/fanwire@<$repoId>`. If the PUT is refused, stop and ask
   the Director.
   ```powershell
   gh api repos/DavidDems/fanwire/actions/oidc/customization/sub
   ```
5. The `production` environment and its five variables: do steps 2 and 3 of
   [Deploy workflow setup](../../CodeContext/Standards/build-deployment-deploy-setup.md),
   adding `--repo DavidDems/fanwire` to each `gh variable set`.
   Check: `branch_policy` and `required_reviewers`, then five `VITE_` names.
   ```powershell
   gh api repos/DavidDems/fanwire/environments/production --jq ".protection_rules[].type"; gh variable list --repo DavidDems/fanwire --env production
   ```
6. Secrets, as **repository** secrets
   ([Secrets](github-automation-setup-secrets.md)). Each command prompts for
   the value. Paste it there and nowhere else. For `AGENT_DISPATCH_TOKEN`,
   first create a fine-grained PAT at
   <https://github.com/settings/personal-access-tokens/new>: **Only select
   repositories** → `DavidDems/fanwire`; **Actions** read and write and
   **Contents** read and write; nothing else.
   ```powershell
   gh secret set ANTHROPIC_API_KEY --repo DavidDems/fanwire
   ```
   ```powershell
   gh secret set TYPESAFE_API_KEY --repo DavidDems/fanwire
   ```
   ```powershell
   gh secret set AGENT_DISPATCH_TOKEN --repo DavidDems/fanwire
   ```
   Check: exactly those three names.
   ```powershell
   gh secret list --repo DavidDems/fanwire
   ```
7. Repository flags: head branches deleted on merge, secret scanning and
   push protection, Dependabot alerts, private vulnerability reporting.
   Dependabot security updates stay off: Renovate opens updates.
   ```powershell
   gh api -X PATCH repos/DavidDems/fanwire -F delete_branch_on_merge=true -f "security_and_analysis[secret_scanning][status]=enabled" -f "security_and_analysis[secret_scanning_push_protection][status]=enabled"
   ```
   ```powershell
   gh api -X PUT repos/DavidDems/fanwire/vulnerability-alerts; gh api -X PUT repos/DavidDems/fanwire/private-vulnerability-reporting
   ```
   Check: `delete_branch_on_merge` is `true`, both scanning statuses are `enabled`, `dependabot_security_updates` is `disabled`, and the last call prints `{"enabled":true}`.
   ```powershell
   gh api repos/DavidDems/fanwire --jq "{delete_branch_on_merge,security_and_analysis}"; gh api repos/DavidDems/fanwire/private-vulnerability-reporting
   ```

## 5. Push the snapshot

```powershell
git -C C:\Users\david\source\repos\fanwire-new remote add origin https://github.com/DavidDems/fanwire.git; git -C C:\Users\david\source\repos\fanwire-new push -u origin main
```
Check: this prints the noreply address, and the repository's front page
shows one commit.
```powershell
gh api repos/DavidDems/fanwire/commits/main --jq .commit.author.email
```
The push starts `deploy.yml`, waiting on `production`: reject it in the
Actions tab (**Review deployments** → **Reject**); AWS still trusts only
the archive.
Check: `deploy` shows as failed or rejected, and `test-agent` succeeded.
```powershell
gh run list --repo DavidDems/fanwire --limit 6
```

## 6. The `main` ruleset

After the push, which its pull-request rule would refuse. Copy the archive's;
[Ruleset](github-automation-setup-ruleset.md) lists its rules.
```powershell
gh api repos/DavidDems/fanwire-archive/rulesets/23744523 --jq "{name,target,enforcement,bypass_actors,conditions,rules}" | gh api -X POST repos/DavidDems/fanwire/rulesets --input -
```
Check: the first prints `pull_request`, `required_status_checks`,
`deletion` and `non_fast_forward`. The second prints `gate` and
`guard-gate`.
```powershell
gh api repos/DavidDems/fanwire/rules/branches/main --jq ".[].type"
```
```powershell
gh api repos/DavidDems/fanwire/rules/branches/main --jq ".[].parameters.required_status_checks[]?.context"
```

## 7. AWS trust: before any deploy

The deploy role trusts `repo:DavidDems@71515505/fanwire@1373722771:environment:production`.
The owner id stays the same, and the repository id is now `$repoId`.

1. The Director opens a PR in the new repository on `director/cutover-trust`.
   It replaces `1373722771` with `$repoId` in
   `infra/iam/github-actions-deploy-role-trust-policy.json`,
   `.ai/tests/test_deploy_workflow.py`, `infra/iam/README.md`,
   `wiki/CodeContext/Modules/0x00c-architecture-aws-account.md`,
   `wiki/CodeContext/Standards/build-deployment.md` and
   `wiki/CodeContext/Standards/build-deployment-deploy-setup.md`.
   Check: on the branch, `git grep 1373722771` finds only this runbook
   (step 3 needs it). The PR shows
   `gate` and `guard-gate` as required, and both pass.
2. Apply the trust from that branch.
   ```powershell
   git -C C:\Users\david\source\repos\fanwire-new fetch origin; git -C C:\Users\david\source\repos\fanwire-new switch director/cutover-trust
   ```
   ```powershell
   aws iam update-assume-role-policy --profile fanwire-workload --role-name GitHubActionsDeployRole --policy-document file://C:/Users/david/source/repos/fanwire-new/infra/iam/github-actions-deploy-role-trust-policy.json
   ```
   Check: the subject printed ends `fanwire@<$repoId>:environment:production`.
   ```powershell
   aws iam get-role --profile fanwire-workload --role-name GitHubActionsDeployRole --query Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals
   ```
3. Review and merge the PR. Merging it does not start a deploy, because
   `infra/iam/` is not a deploy path.

## 8. First deploy

Do steps 4 and 5 of
[Deploy workflow setup](../../CodeContext/Standards/build-deployment-deploy-setup.md),
adding `--repo DavidDems/fanwire` to `gh workflow run`.
Check: the run succeeds. `cdk diff` shows no change beyond the bundle, and
`/api/users/me` returns 200 in the browser. If the login is refused, use that
page's CloudTrail command.

## 9. Integrations

1. Renovate. At <https://github.com/settings/installations>, open **Mend
   Renovate** → **Configure** → **Only select repositories**, add `fanwire`
   and remove `fanwire-archive`. Then follow step 8 of
   [Renovate](github-automation-setup-renovate.md) (Interactive mode).
   Check: a **Dependency Dashboard** issue opens within an hour.
2. Scorecard and CodeQL are workflows. Dispatch Scorecard once.
   ```powershell
   gh workflow run scorecard.yml --repo DavidDems/fanwire --ref main
   ```
   Check: both `scorecard` and `codeql` show a successful run, and
   `gh api repos/DavidDems/fanwire/code-scanning/default-setup --jq .state` prints `not-configured`.
3. Install the hook in the new clone.
   ```powershell
   git -C C:\Users\david\source\repos\fanwire-new switch main; git -C C:\Users\david\source\repos\fanwire-new pull --ff-only; git -C C:\Users\david\source\repos\fanwire-new config core.hooksPath .ai/hooks
   ```
   Check: `git -C C:\Users\david\source\repos\fanwire-new config core.hooksPath` prints `.ai/hooks`.

## 10. Archive

Only once step 8 has passed:

1. Turn off the archive's Actions, so its schedules spend no private
   minutes, then make it private.
   ```powershell
   gh api -X PUT repos/DavidDems/fanwire-archive/actions/permissions -F enabled=false
   ```
   ```powershell
   gh repo edit DavidDems/fanwire-archive --visibility private --accept-visibility-change-consequences
   ```
   Check: `private`.
   ```powershell
   gh api repos/DavidDems/fanwire-archive --jq .visibility
   ```
2. Remove the archive's credentials. Revoke its old dispatch PAT at
   <https://github.com/settings/personal-access-tokens>, then delete its
   secrets.
   ```powershell
   gh secret delete ANTHROPIC_API_KEY --repo DavidDems/fanwire-archive; gh secret delete TYPESAFE_API_KEY --repo DavidDems/fanwire-archive; gh secret delete AGENT_DISPATCH_TOKEN --repo DavidDems/fanwire-archive
   ```
   Check: `gh secret list --repo DavidDems/fanwire-archive` prints nothing.

## 11. Local folders

After step 10, close everything open in either folder, Claude Code included;
use a new window. The new clone inherits Claude Code's memory path.
```powershell
Copy-Item C:\Users\david\source\repos\fanwire\backend\.env C:\Users\david\source\repos\fanwire-new\backend\; Copy-Item C:\Users\david\source\repos\fanwire\frontend\.env.local, C:\Users\david\source\repos\fanwire\frontend\.env.test-accounts.local C:\Users\david\source\repos\fanwire-new\frontend\
```
```powershell
Rename-Item C:\Users\david\source\repos\fanwire fanwire-archive; Rename-Item C:\Users\david\source\repos\fanwire-new fanwire
```
Check: `git -C C:\Users\david\source\repos\fanwire remote -v` names `DavidDems/fanwire.git` on both lines.
