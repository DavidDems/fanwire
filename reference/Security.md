# Security — Self-Managed on AWS

No hosting provider, no third-party WAF/CDN. All security is implemented with native AWS services. Requirements, not suggestions — treat each as a hard gate before production traffic. Pairs with [[AWS Stack]] and the security baseline in [[Design principles]].

## Account structure
- Use **AWS Organizations** (free) with a minimum of two accounts: `workload` and `log-archive`. Logs and backups live in the account the workload account cannot delete from — this is what survives a workload account compromise.
- Root user on every account: MFA hardware/virtual key enabled, credentials never used day-to-day, access keys deleted (root has none).
- Humans and CI never use IAM users with long-lived access keys. Humans assume roles via IAM Identity Center (SSO); CI assumes roles via OIDC federation (see [[AWS Stack]]).

## Identity & access
- Every Lambda, service, and pipeline gets its **own IAM role** scoped to exactly the actions/resources it touches. No shared "app role" used by multiple functions.
- No `*` in an `Action` or `Resource` field in production IAM policy, ever. Deny-by-default is the starting position, not a review comment.
- Use **permission boundaries** on any role capable of creating other IAM roles (CI/CDK deploy role) to cap privilege escalation.

## Network
- **CloudFront is the only public entry point.** S3 buckets are private (Origin Access Control only); API Gateway is not called directly from the internet in front of it.
- No SSH/RDP anywhere. If a compute instance ever exists, admin access is via **SSM Session Manager**, not an open port 22/3389.
- If a VPC is used (RDS case), data-layer resources sit in **private subnets** with security groups that allow inbound only from the specific Lambda security group — never `0.0.0.0/0` on anything but the public load balancer/CloudFront, and this project has neither.

## Edge / application protection
- **AWS WAF** attached to the CloudFront distribution: AWS Managed Rule Groups (Core rule set + Known Bad Inputs + SQLi) plus a rate-based rule capping requests per IP. This is the primary defense layer at this project's scale.
- **Shield Standard** — automatic, free, always on for CloudFront/Route 53. **Shield Advanced is not justified** at low-traffic/low-budget scale (flat $3k/mo commitment) — do not enable it.
- Rate limiting and request validation also enforced at API Gateway (usage plans/throttling) as a second layer behind WAF, not a replacement for it.

## Data protection
- Encryption at rest on everything by default: S3 (SSE-KMS), DynamoDB/RDS (KMS), EBS if any. Use a **customer-managed KMS key** (not the AWS-managed default) for anything containing customer data, so key policy and rotation are explicit and auditable.
- TLS 1.2+ everywhere in transit — enforced via CloudFront viewer policy and ACM certs, no plaintext HTTP path left reachable.
- Secrets (API keys, DB credentials, third-party tokens) live in **SSM Parameter Store (SecureString)** for low-volume needs or **Secrets Manager** when automatic rotation is required. Never in environment files committed to git, never in Lambda console-edited env vars without encryption.

## Detection & response
- **GuardDuty** enabled in every account, findings routed to the `log-archive` account.
- **CloudTrail**: one multi-region trail, logs delivered to an S3 bucket in `log-archive` with Object Lock (write-once) so an attacker with workload-account access cannot cover their tracks.
- **AWS Config** tracking drift on IAM, security groups, and S3 bucket policies at minimum.
- **Security Hub** is optional at this budget — it aggregates GuardDuty/Config/Inspector findings into one dashboard but has its own per-finding cost. Skip it until the account count or finding volume makes manual review of each service painful.
- Have a written one-page incident runbook (what to do if GuardDuty fires, who/what gets locked out first) before launch — writing it after an incident is too late.

## Application-layer (OWASP ASVS baseline)
- All input validated at the boundary (API Gateway request validators + Pydantic schema validation) — never trust client input, per [[Design principles]].
- All authN/authZ checks enforced server-side in Lambda; Cognito tokens verified on every request, never trusted based on client claims alone.
- Dependency/CVE scanning (`pip-audit`/Dependabot for the FastAPI backend, `npm audit`/Dependabot for the React frontend) runs in CI; secrets-scanning (gitleaks or equivalent) runs pre-commit and in CI — both block merge on a hit.
- Structured logs must never contain secrets or unhashed PII — scrub at the log statement, not after the fact.

## User-generated content (feed/posts specific)
- Rate-limit posting and reporting per user (API Gateway usage plan + an app-level check against the DynamoDB cache table) — a discussion feed is a spam target from day one, not an edge case.
- The moderation chain in [[Gang of Four Example]] (`ProfanityFilter → SpamScoreCheck → RateLimitCheck → DuplicateContentCheck`) runs synchronously before a post is persisted, not as an after-the-fact cleanup job.
- Media uploads are in scope for v1 with stricter limits than the rest of the app: presigned upload to a private quarantine bucket only, an allow-listed image MIME type set, and a hard per-file size cap (see [[AWS Stack]] for the full pipeline). **GuardDuty Malware Protection for S3** scans every object before it can be processed or served — nothing reaches the public media bucket unscanned, and nothing that fails scan or validation is kept.
- Never trust a client-declared content type or file extension — the processing Lambda verifies actual file contents before treating an upload as an image.
- Rate-limit uploads per user, same as posts — an open upload endpoint is a storage-cost and abuse vector on its own, independent of malware risk.
- The third-party sports API key is a shared secret, not a user secret — it lives in Secrets Manager, is scoped to the ingestion Lambda's role only, and is never reachable from any client-facing code path.
