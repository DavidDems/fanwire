# 02 — Deployment: what is still yours to do

**Status as of 2026-09-24: almost nothing.** Every AWS prerequisite is done —
the domain, the hosted zone and its delegation, the IAM review, CDK bootstrap in
both regions, and the deploy-role policy. GuardDuty is confirmed, the budget is
accepted, and the API-SPORTS key is declined.

**Two items remain, and only one is available now:**

| | Item | Available? |
|---|---|---|
| §1 | The dev S3 buckets | **Yes** — ~10 minutes, and it appears not to be done |
| §2 | The post-deploy checklist | No — needs a deploy to have happened |

Everything that *was* in this file and is now finished has been moved into the
wiki, where it belongs as current-state fact rather than a checklist:

- **AWS account state** — accounts, SSO, OIDC, the attached deploy-role policy,
  Route 53 and the delegated subdomain, CDK bootstrap, GuardDuty, CloudTrail,
  Config, Budgets: `wiki/CodeContext/Modules/0x00-architecture.md` → "AWS
  account state".
- **Why the first deploy still cannot serve a website** — no `BucketDeployment`,
  no frontend-only deploy, no frontend config mechanism, no migration runner:
  same file → "Known gaps". Those are **agent tasks**, not yours; `INFRA-002`
  covers the upload path.
- **The eight IAM wildcard waivers** and your ACCEPT on each: the allow-list in
  `infra/test/iam-policy.test.ts`, which is also the gate that fails the build
  if one stops matching.
- **Repository/GitHub settings** (not AWS):
  `wiki/GeneralContext/Architecture/github-automation-setup.md`.

> `TODO/01-ai-workflow-setup.md` is deleted — every item in it was closed, and
> its durable content is the last link above.

---

## 1. The dev S3 buckets — yours, ~10 minutes

**This looks outstanding.** `backend/.env` currently holds only the three
`COGNITO_*` variables, with none of the bucket variables §1c adds — so §1c at
least has not been done. If you did create the buckets and only skipped the
`.env` step, do §1c and skip to §1d to confirm.

**Which bucket this is about.** Three separate S3 stories, and only one needs
you:

| Bucket | Who creates it | Needs you? |
|---|---|---|
| **Frontend** (`StorageStack.frontendBucket`) | CDK, on deploy | **No.** The gap there is that nothing *uploads* to it — missing infra code, tracked as `INFRA-002`. |
| **Prod media** (quarantine + public) | CDK, on deploy | No. |
| **Dev media** (quarantine + public) | **You, by hand** | **Yes** — everything below. |

These exist because of the decision in
[`03-open-decisions.md`](03-open-decisions.md) §1: real S3 rather than an
emulator, so media upload can be clicked through in a browser before anything is
deployed. Cost is pennies at dev volume.

The JSON these commands reference is committed at
[`../infra/dev/`](../infra/dev/) — read it before applying it; the bucket names
are baked into the policy ARNs.

### 1a. Create them

Every command is one line. Run them in order, **from the repository root** (the
`file://` paths in §1b are relative).

```powershell
aws sso login --profile fanwire-workload
aws s3api create-bucket --bucket fanwire-dev-quarantine-294321867941 --region ca-central-1 --create-bucket-configuration LocationConstraint=ca-central-1 --profile fanwire-workload
aws s3api create-bucket --bucket fanwire-dev-public-media-294321867941 --region ca-central-1 --create-bucket-configuration LocationConstraint=ca-central-1 --profile fanwire-workload
```

**DONE, here was the outputs:**
{
    "Location": "http://fanwire-dev-quarantine-294321867941.s3.amazonaws.com/"
}
{
    "Location": "http://fanwire-dev-public-media-294321867941.s3.amazonaws.com/"
}

`--create-bucket-configuration LocationConstraint` is required for every region
except `us-east-1`. Without it the bucket is silently created in Virginia.

### 1b. Lock them down before putting anything in them

```powershell
aws s3api put-public-access-block --bucket fanwire-dev-quarantine-294321867941 --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false" --profile fanwire-workload
aws s3api put-public-access-block --bucket fanwire-dev-public-media-294321867941 --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false" --profile fanwire-workload
aws s3api put-bucket-encryption --bucket fanwire-dev-quarantine-294321867941 --server-side-encryption-configuration '{\"Rules\":[{\"ApplyServerSideEncryptionByDefault\":{\"SSEAlgorithm\":\"AES256\"}}]}' --profile fanwire-workload
aws s3api put-bucket-encryption --bucket fanwire-dev-public-media-294321867941 --server-side-encryption-configuration '{\"Rules\":[{\"ApplyServerSideEncryptionByDefault\":{\"SSEAlgorithm\":\"AES256\"}}]}' --profile fanwire-workload
aws s3api put-bucket-policy --bucket fanwire-dev-quarantine-294321867941 --policy file://infra/dev/dev-quarantine-tls-only-policy.json --profile fanwire-workload
aws s3api put-bucket-policy --bucket fanwire-dev-public-media-294321867941 --policy file://infra/dev/dev-public-media-tls-only-policy.json --profile fanwire-workload
aws s3api put-bucket-cors --bucket fanwire-dev-quarantine-294321867941 --cors-configuration file://infra/dev/dev-quarantine-cors.json --profile fanwire-workload
```

**ALL DONE, NO OUTPUT FROM ANY COMMAND WHICH SUGGESTS EVERYTHING WORKED**

Two deliberate choices, so they are not a surprise:

- `BlockPublicPolicy=false` and `RestrictPublicBuckets=false`, because a bucket
  policy is exactly what you are about to attach. `BlockPublicAcls` and
  `IgnorePublicAcls` stay **true** — ACLs are the legacy path and nothing here
  needs them.
- **SSE-S3 (`AES256`), not the CMK.** Production uses the customer-managed key
  from `DataStack`, which does not exist yet. Dev data is disposable test
  images, and a dev bucket waiting on a production key would block the thing it
  exists to unblock.

### 1c. Tell the backend about them

Add these three lines to `backend/.env` (it exists and holds the dev Cognito
values; it is gitignored):

```
MEDIA_QUARANTINE_BUCKET=fanwire-dev-quarantine-294321867941
MEDIA_PUBLIC_BUCKET=fanwire-dev-public-media-294321867941
AWS_DEFAULT_REGION=ca-central-1
```

These map to `media_quarantine_bucket`, `media_public_bucket` and
`aws_default_region` in `backend/app/settings.py`, whose defaults point at
bucket names that do not exist. Route tests override the S3 client with `moto`
and never touch a real bucket, so CI is unaffected either way.

**DONE, all three lines have been appended to the existing cognito values in '/backend/.env'**

### 1d. Confirm it worked

```powershell
aws s3api get-bucket-location --bucket fanwire-dev-quarantine-294321867941 --profile fanwire-workload
aws s3api get-bucket-cors --bucket fanwire-dev-quarantine-294321867941 --profile fanwire-workload
aws s3api get-bucket-policy --bucket fanwire-dev-public-media-294321867941 --profile fanwire-workload
aws s3 ls --profile fanwire-workload | Select-String fanwire-dev
```

You want `ca-central-1` from the first, the localhost origins from the second,
the TLS-only deny from the third, and **both** buckets from the fourth.

**DONE, all 4 outputs that were needed were received, the implementation seems to have worked perfectly.**
-1: aws s3api get-bucket-location --bucket fanwire-dev-quarantine-294321867941 --profile fanwire-workload
{
    "LocationConstraint": "ca-central-1"
}
-2: aws s3api get-bucket-cors --bucket fanwire-dev-quarantine-294321867941 --profile fanwire-workload
{
    "CORSRules": [
        {
            "AllowedHeaders": [
                "*"
            ],
            "AllowedMethods": [
                "POST",
                "GET",
                "HEAD"
            ],
            "AllowedOrigins": [
                "http://localhost:5173",
                "http://localhost:8001"
            ],
            "ExposeHeaders": [
                "ETag",
                "Location"
            ],
            "MaxAgeSeconds": 3000
        }
    ]
}
-3: aws s3api get-bucket-policy --bucket fanwire-dev-public-media-294321867941 --profile fanwire-workload
{
    "Policy": "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"DenyPlaintextTransport\",\"Effect\":\"Deny\",\"Principal\":\"*\",\"Action\":\"s3:*\",\"Resource\":[\"arn:aws:s3:::fanwire-dev-public-media-294321867941\",\"arn:aws:s3:::fanwire-dev-public-media-294321867941/*\"],\"Condition\":{\"Bool\":{\"aws:SecureTransport\":\"false\"}}}]}"
}
-4:  aws s3 ls --profile fanwire-workload | Select-String fanwire-dev

2026-09-25 11:34:16 fanwire-dev-public-media-294321867941
2026-09-25 11:34:23 fanwire-dev-quarantine-294321867941

### 1e. What is still missing after this — not your step

The buckets alone do not make media upload work. Locally there is no GuardDuty,
so nothing issues the scan verdict that moves an object from `Quarantined` to
`Processed`, and an unprocessed image cannot be attached to a post. The decision
in [`03`](03-open-decisions.md) §1 included **a dev-only script that runs the
processing pipeline on demand**, and that script does not exist yet.

It is written up as an agent task — `MEDIA-002` in [`.ai/tasks/`](../.ai/tasks/).
Until it exists, these buckets accept uploads that then sit in `Quarantined`
forever, which is correct behaviour and not a bug.

---

## 2. After the first deploy — not available yet

None of this can be done before the resources exist. It is here because each one
silently does nothing until someone does it.

- [ ] **GuardDuty Malware Protection for S3** on the quarantine bucket. A
      separate feature from GuardDuty core, and what `media/` actually depends
      on: uploads never leave `Quarantined` without a scan verdict, so
      compose-with-media is broken until it is on.
- [ ] **Verify the SES identity** for `fanwire.daviddems.com` and request
      production access — a new SES account is sandboxed and can only send to
      verified addresses. Until then `NOTIFICATION_FROM_ADDRESS` stays unset and
      email notification is a deliberate no-op.
- [ ] **Confirm the ACM certificate validated** and the aliases resolve:
      `nslookup fanwire.daviddems.com` should return CloudFront addresses.
- [ ] **Re-run the IAM gate against reality.** `iam-policy.test.ts` reads
      synthesized templates; a deploy is the first time AWS itself evaluates
      them. Expect the GuardDuty bucket-policy interaction to differ from the
      synthesized guess — a documented known gap, not a regression.
- [ ] **Narrow `cfn-exec-role`.** Bootstrap took the default
      `AdministratorAccess`, so this is a real open item rather than a
      hypothetical. Do it once a successful deploy has shown what is actually
      used.
- [ ] **Review `lambda-vpc-eni`.** Your ACCEPT on that IAM waiver was
      conditional: *"an R&D agent must look at this setup to make sure we aren't
      using a crude implementation."* The question to answer: whether the six
      inline ENI actions on `Resource "*"` are genuinely AWS's floor for a
      VPC-attached Lambda, or whether the VPC attachment is avoidable for some
      of the four functions — a function needing no RDS access needs no ENI
      permissions at all. That is a design review, and it wants the real
      deployed topology in front of it.

---

## Deferred by the project, not waiting on you

- A production migration runner — `alembic` is not in the `lambda` image.
- Reading DB credentials from Secrets Manager rather than `DATABASE_URL`.
- Automated security alerting (SNS/EventBridge) — planned, not built.
- Named resource-level lockout steps in the runbook — blocked on the CDK stacks
  existing.
- GuardDuty's real tagging/bucket-policy interaction and the scan-result event
  shape — **unverifiable until a real deploy**, so expect surprises in the media
  pipeline on day one.
