# AWS Stack — Sports Discussion App, Cheap & Low-Traffic

Optimized for near-zero idle cost with room to scale if traffic grows. Every component chosen is pay-per-use — nothing billed while idle except flat per-resource minimums explicitly noted. Pairs with [[wiki/CodeContext/Standards/security|Security]] for the hardening layer, [[wiki/CodeContext/Standards/design-principles|Design principles]] for app-level rules, and [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]] for how the backend modules are structured.

## Backend language & framework
- Keep **Python + FastAPI** — it's the right choice for this domain, proven in your last project, and runs fine at this scale. No reason to switch languages.
- **Pydantic v2** for request/response schemas (unchanged from before).
- **SQLAlchemy 2.0 ORM** for data access (unchanged from before) — now against Postgres instead of MySQL, see Data below.
- Wrap FastAPI with **Mangum** to run it on Lambda unmodified — same route handlers, no separate "serverless" rewrite.
- If a feature later needs a persistent connection (live score push to open clients), add it as a separate small service on **API Gateway WebSocket API** rather than moving the whole API off Lambda.

## Compute
- **Lambda** for the FastAPI app (via Mangum), scheduled ingestion jobs, and event consumers. At low/variable traffic Lambda is dramatically cheaper than Fargate or EC2 — cost is per-invocation and per-GB-second, zero when idle. Only move a workload off Lambda if a single invocation regularly runs >5s sustained or needs >15 min runtime (Lambda's hard cap) — then use **Fargate**, not EC2.
- **API Gateway (HTTP API, not REST API)** in front of Lambda — ~70% cheaper per request than REST API with the features this project needs.

## Data
- **RDS Postgres (db.t4g.micro)** as the primary datastore. This domain is relational at its core — users, follows, posts, threads, mentions joining to events — and Postgres gives you real joins, transactions, and full-text search (`tsvector`) for the search/ module, all of which a feed-and-mentions app needs constantly. This also maps directly onto your existing SQLAlchemy experience; only the dialect changes (MySQL → Postgres).
- Accept ~$12–15/mo for RDS after the 12-month free tier. Do **not** use Aurora Serverless v2 at this scale — it bills a non-zero minimum ACU continuously even near-idle, more expensive than a small RDS instance for low traffic.
- **DynamoDB, on-demand**, used narrowly as a cache/idempotency table — not the system of record. Two jobs: (1) short-TTL cache for live scores behind `CachedEventProxy` (see [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]]), (2) idempotency keys for the ingestion pipeline so a retried fetch never double-publishes a `PostMentionedEvent`. No idle cost, which is exactly right for data that's disposable.

## Sports data ingestion
- **API-SPORTS** (api-sports.io) as the primary provider — one consistent schema across football, basketball, baseball, hockey, etc., each sport its own free tier (100 requests/day, no card required) with cheap paid tiers if you outgrow it. This is the easiest real path to "most professional leagues" data without scraping.
- **EventBridge Scheduler** triggers an ingestion Lambda: frequent (every 1–5 min) during windows with live games, hourly otherwise — don't poll on a fixed tight interval around the clock, it burns free-tier requests for no benefit when nothing is live.
- Ingestion Lambda implements `AbstractEventIngestionPipeline` (fetch → normalize → dedupe via the DynamoDB idempotency table → match to existing mentions → publish to `PostEventBus`/EventBridge). `events/` never talks to the vendor SDK directly outside the `ApiSportsAdapter`.
- Store the API-SPORTS key in Secrets Manager/Parameter Store, never in Lambda console env vars in plaintext (see [[wiki/CodeContext/Standards/security|Security]]).

## Media uploads
- Client never uploads to a public bucket directly. Backend issues a short-lived, scoped **presigned S3 upload URL** with stricter limits than anything else in the app: max ~5MB per image, allow-list `image/jpeg`, `image/png`, `image/webp` only — reject everything else, including SVG (it can carry executable/script content).
- Upload target is a private **quarantine bucket** — never reachable via CloudFront, never public.
- **GuardDuty Malware Protection for S3** enabled on the quarantine bucket — scans every new object on upload; it can run standalone without enabling full GuardDuty if you want to keep it cost-scoped. This is the AWS-native scan called for in [[wiki/CodeContext/Standards/security|Security]], no third-party AV service needed.
- On upload, an S3 event triggers a processing Lambda (**Pillow**, matching the Python backend — no need for a Node/Sharp side-service) that: verifies the real file type by actually opening/parsing the image rather than trusting the extension or declared `Content-Type`, strips EXIF metadata (a user's photo can otherwise leak GPS location), and generates the served size plus a thumbnail.
- Only after the malware scan passes and processing succeeds does the Lambda copy the output to the **public media bucket** — the only media bucket CloudFront serves. Anything that fails scan or validation is deleted, not silently kept for review.
- Rate-limit uploads per user the same way posts are rate-limited (see [[wiki/CodeContext/Standards/security|Security]]) — an open upload endpoint is a storage-cost and abuse vector independent of the malware question.
- Structurally this is the same shape as `AbstractEventIngestionPipeline` in [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]] (fetch/validate → normalize → publish) — media processing is a Template Method too.

## Frontend
- **React + TypeScript**, built with **Vite** (faster dev/build than CRA, no reason to use anything heavier for this).
- Component/design layer: install the UI design skill yourself before using it — `! npx -y skills add omer-metin/skills-for-antigravity --skill ui-design --agent claude-code` — review what that repo actually installs first, since it's an individual's package pulling and running code on your machine.
- Serve the built static bundle from **S3 + CloudFront** (same distribution or a second one in front of the API — see Storage/CDN/DNS below).

## Storage, CDN, DNS
- **S3** for the built frontend and the two-bucket media pipeline (quarantine + public) described under Media uploads above.
- **CloudFront** in front of S3 and API Gateway — this is also the security edge (see [[wiki/CodeContext/Standards/security|Security]]). Never expose S3 or API Gateway directly to the internet.
- **Route 53** for DNS, **ACM** for TLS certificates (free, auto-renewing, required for CloudFront anyway).

## Auth
- **Cognito** — free tier covers 50k+ MAU, handles password storage, MFA, token issuance. Do not roll your own auth.

## Async / decoupling
- **EventBridge** for domain events — this is the literal implementation of the Observer pattern's `PostEventBus` in [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]]: `posts/` publishes, `feed/`/`notifications/`/`moderation/`/`reporting/` subscribe independently.
- **SQS** (with a dead-letter queue on every consumer queue) for anything that must survive a downstream outage — notification fan-out, ingestion retries.

## Messaging
- **SES** for transactional email, **SNS** for push/SMS. Both pay-per-message, no idle cost.

## Infrastructure as code
- **AWS CDK** (TypeScript, even though the backend is Python — CDK's Python bindings also work if you'd rather keep one language; pick one and stay consistent). Every resource defined in code, reviewed like any other PR, never created by hand in the console.

## CI/CD
- **GitHub Actions**, deploying via CDK. Assume an IAM role via **OIDC federation** — no long-lived AWS access keys stored in GitHub secrets, ever.

## Observability & cost control
- **CloudWatch** Logs/Metrics/Alarms — default log retention set explicitly (never "never expire") to control storage cost.
- **AWS Budgets** with an SNS alarm at a hard dollar threshold — this is the tripwire against a runaway bill, set it up before anything else goes live.

## Explicitly rejected at this scale
- **NAT Gateway** — hourly cost regardless of traffic. Lambda needs VPC access here (to reach RDS) — use a VPC endpoint for AWS service calls (S3, DynamoDB, Secrets Manager) instead of routing through NAT.
- **Application Load Balancer** — hourly cost regardless of traffic. API Gateway replaces it for HTTP workloads.
- **ElastiCache** — hourly cost regardless of traffic. The DynamoDB cache table above covers the caching need at this scale; revisit ElastiCache only if cache read volume genuinely outgrows it.
- **Third-party hosting/PaaS (Vercel, Heroku, Render, etc.)** — explicitly out of scope per your requirement to run security yourself on AWS primitives.
