# `infra/dev/` — JSON for the hand-made dev buckets

Configuration for the **development** S3 buckets, which are created by hand in
`fanwire-workload` and are not part of the CDK app. The CDK owns the real
buckets (`StorageStack`); these exist so media upload can be clicked through in
a browser before anything is deployed — the decision recorded in
[`../../TODO/03-open-decisions.md`](../../TODO/03-open-decisions.md) §1.

They live here as files, rather than inline in a command, for two reasons: a
policy you can read in a diff is a policy you can review, and every command in
`TODO/` has to fit on one line (see [`../../TODO/README.md`](../../TODO/README.md)).

| File | Applied to | With |
|---|---|---|
| `dev-quarantine-cors.json` | quarantine bucket | `aws s3api put-bucket-cors` |
| `dev-quarantine-tls-only-policy.json` | quarantine bucket | `aws s3api put-bucket-policy` |
| `dev-public-media-tls-only-policy.json` | public-media bucket | `aws s3api put-bucket-policy` |

**The bucket names are baked into the policy ARNs.** They are
`fanwire-dev-quarantine-294321867941` and
`fanwire-dev-public-media-294321867941` — the account id is a suffix because S3
bucket names are globally unique across all AWS customers, and `fanwire-dev-*`
alone would likely be taken. If you change a name, change it in the matching
policy file too or the policy applies to a bucket that does not exist.

The TLS-only deny mirrors the posture the CDK buckets get, and is the same shape
the IAM gate allows under its `tls-only-deny` waiver: broad in a `Deny` is the
safe direction. The CORS rule allows the Vite dev server and the local backend
to issue the presigned `POST` that `media/` uses.

Nothing here is applied automatically. The steps are in
[`../../TODO/02-deployment-requirements.md`](../../TODO/02-deployment-requirements.md) §7.
