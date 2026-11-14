---
type: reference
---

# Security — Self-Managed on AWS

No hosting provider, no third-party WAF/CDN. All security is implemented with native AWS services. Requirements, not suggestions — treat each as a hard gate before production traffic. Pairs with [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] and the security baseline in [[wiki/CodeContext/Standards/design-principles|Design principles]].

## Account structure
- Use **AWS Organizations** (free) with a minimum of two accounts: `workload` and `log-archive`. Logs and backups live in the account the workload account cannot delete from — this is what survives a workload account compromise.
- Root user on every account: MFA hardware/virtual key enabled, credentials never used day-to-day, access keys deleted (root has none).
- Humans and CI never use IAM users with long-lived access keys. Humans assume roles via IAM Identity Center (SSO); CI assumes roles via OIDC federation (see [[wiki/CodeContext/Standards/aws-stack|AWS Stack]]).

## Identity & access
- Every Lambda, service, and pipeline gets its **own IAM role** scoped to exactly the actions/resources it touches. No shared "app role" used by multiple functions.
- No `*` in an `Action` or `Resource` field in production IAM policy, ever. Deny-by-default is the starting position, not a review comment.
- Use **permission boundaries** on any role capable of creating other IAM roles (CI/CDK deploy role) to cap privilege escalation.

## Network
- **CloudFront is the only public entry point.** S3 buckets are private (Origin Access Control only); API Gateway is not called directly from the internet in front of it.
- No SSH/RDP anywhere. If a compute instance ever exists, admin access is via **SSM Session Manager**, not an open port 22/3389.
- If a VPC is used (RDS case), data-layer resources sit in **private subnets** with security groups that allow inbound only from the specific Lambda security group — never `0.0.0.0/0` on anything but the public load balancer/CloudFront, and this project has neither.

## Edge / application protection
- **AWS WAF** attached to the CloudFront distribution: AWS Managed Rule Groups `AWSManagedRulesCommonRuleSet`, `AWSManagedRulesKnownBadInputsRuleSet` and `AWSManagedRulesSQLiRuleSet`, plus a per-IP rate-based rule (1,000 requests per 5 min). This is the primary defense layer at this project's scale.
- **Shield Standard** — automatic, free, always on for CloudFront/Route 53. **Shield Advanced is not justified** at low-traffic/low-budget scale (flat $3k/mo commitment) — do not enable it.
- Rate limiting and request validation also enforced at API Gateway as a second layer behind WAF, not a replacement for it: the HTTP API's stage throttle (50 rps, burst 100). HTTP APIs have no usage plans.

## Data protection
- Encryption at rest on everything by default: S3 (SSE-KMS), DynamoDB/RDS (KMS), EBS if any. Use a **customer-managed KMS key** (not the AWS-managed default) for anything containing customer data, so key policy and rotation are explicit and auditable.
- TLS 1.2+ everywhere in transit — enforced via CloudFront viewer policy and ACM certs, no plaintext HTTP path left reachable.
- Secrets (API keys, DB credentials, third-party tokens) live in **SSM Parameter Store (SecureString)** for low-volume needs or **Secrets Manager** when automatic rotation is required. Never in environment files committed to git, never in Lambda console-edited env vars without encryption.

## Detection & response
- **GuardDuty** enabled in every account, findings routed to the `log-archive` account.
- **CloudTrail**: one multi-region trail, logs delivered to an S3 bucket in `log-archive` with Object Lock (write-once) so an attacker with workload-account access cannot cover their tracks.
- **AWS Config** tracking drift on IAM, security groups, and S3 bucket policies at minimum.
- **Security Hub** is optional at this budget — it aggregates GuardDuty/Config/Inspector findings into one dashboard but has its own per-finding cost. Skip it until the account count or finding volume makes manual review of each service painful.
- The one-page incident runbook (what to do if GuardDuty fires, who/what gets locked out first) is `wiki/GeneralContext/Architecture/incident-runbook.md`; keep it current.

## Application-layer (OWASP ASVS baseline)
- All input validated at the boundary (API Gateway request validators + Pydantic schema validation) — never trust client input, per [[wiki/CodeContext/Standards/design-principles|Design principles]].
- All authN/authZ checks enforced server-side in Lambda; Cognito tokens verified on every request, never trusted based on client claims alone.
- Dependency/CVE scanning runs in CI: `pip-audit` for the FastAPI backend, `npm audit` for the React frontend (blocks at `high`) and `infra/` (blocks at `critical`); both audits block merge. Dependabot alerts are on, and Renovate opens the update PRs.
- Secret scanning: GitHub secret scanning with push protection.
- Structured logs must never contain secrets or unhashed PII — scrub at the log statement, not after the fact.

## User-generated content (feed/posts specific)
- Rate-limit posting and reporting per user — a discussion feed is a spam target from day one, not an edge case. Posting is limited by `RateLimitCheck`, backed by `PostCountRateLimiter` (counts the author's own posts), behind the WAF per-IP rule and the API stage throttle. Reporting has no per-user limit yet ([[wiki/CodeContext/Modules/0x00b-architecture-iam-gaps|0x00b]] "Known gaps").
- The moderation chain in [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]] (`ProfanityFilter → SpamScoreCheck → RateLimitCheck → DuplicateContentCheck`) runs synchronously before a post is persisted, not as an after-the-fact cleanup job.
- Media uploads have stricter limits than the rest of the app: presigned upload to a private quarantine bucket only, an allow-listed image MIME type set, and a hard per-file size cap (see [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] for the full pipeline). **GuardDuty Malware Protection for S3** scans every object before it can be processed or served — nothing reaches the public media bucket unscanned, and nothing that fails scan or validation is kept.
- Never trust a client-declared content type or file extension — the processing Lambda verifies actual file contents before treating an upload as an image.
- Rate-limit uploads per user, same as posts — an open upload endpoint is a storage-cost and abuse vector on its own, independent of malware risk. Not built yet ([[wiki/CodeContext/Modules/0x00b-architecture-iam-gaps|0x00b]] "Known gaps").
- The API-SPORTS key secret has no consumer since `EVENTS-003`. Any third-party key is a shared secret, not a user secret: it stays in Secrets Manager, readable only by the one role that needs it, never by client-facing code.
