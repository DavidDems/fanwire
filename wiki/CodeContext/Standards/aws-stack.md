---
type: reference
---

# AWS Stack — Sports Discussion App, Cheap & Low-Traffic

Optimized for near-zero idle cost with room to scale if traffic grows. Every component chosen is pay-per-use — nothing billed while idle except flat per-resource minimums explicitly noted. Pairs with [[wiki/CodeContext/Standards/security|Security]] for the hardening layer, [[wiki/CodeContext/Standards/design-principles|Design principles]] for app-level rules, and [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]] for how the backend modules are structured.

## Backend language & framework
- **Python + FastAPI** — the right choice for this domain, and it runs fine at this scale. No reason to switch languages.
- **Pydantic v2** for request/response schemas.
- **SQLAlchemy 2.0 ORM** for data access, against Postgres (see Data below).
- Wrap FastAPI with **Mangum** to run it on Lambda unmodified — same route handlers, no separate "serverless" rewrite.
- If a feature later needs a persistent connection (live score push to open clients), add it as a separate small service on **API Gateway WebSocket API** rather than moving the whole API off Lambda.

## Compute
- **Lambda** runs the FastAPI app (via Mangum), event consumers (notifications), media processing, the migration runner and the sports-data load. No scheduled ingestion job exists. At low/variable traffic Lambda is dramatically cheaper than Fargate or EC2 — cost is per-invocation and per-GB-second, zero when idle. Only move a workload off Lambda if a single invocation regularly runs >5s sustained or needs >15 min runtime (Lambda's hard cap) — then use **Fargate**, not EC2.
- **API Gateway (HTTP API, not REST API)** in front of Lambda — ~70% cheaper per request than REST API with the features this project needs.

## Data
- **RDS Postgres (db.t4g.micro)** as the primary datastore. This domain is relational at its core — users, follows, posts, threads, mentions joining to events — and Postgres gives real joins, transactions, and full-text search (`tsvector`) for the search/ module, all of which a feed app needs constantly.
- Accept ~$12–15/mo for RDS after the 12-month free tier. Do **not** use Aurora Serverless v2 at this scale — it bills a non-zero minimum ACU continuously even near-idle, more expensive than a small RDS instance for low traffic.
- **DynamoDB, on-demand**, only ever a cache/idempotency store — never the system of record. Its two tables (`IdempotencyTable`, `LiveScoreCacheTable`) have had no consumer since `EVENTS-003` retired API-SPORTS ingestion; they are kept until a later infra unit removes them. No idle cost, which is exactly right for data that's disposable.

## Sports data
- Game and stats data is the NBA dataset (CSVs under `nba-eoin/` in the sports-data bucket), loaded into Postgres by the `SportsDataLoad` Lambda, invoked by hand ([[wiki/CodeContext/Modules/0x02b-events-loading|0x02b]]; [[wiki/CodeContext/Standards/build-deployment-post-deploy|After a deploy]] "Load sports data"). No live provider is polled.
- The API-SPORTS secret and the ingestion-retry queue + DLQ remain with no consumer since `EVENTS-003`, kept until a later infra unit removes them.

## Media uploads
- Client never uploads to a public bucket directly. Backend issues a short-lived, scoped **presigned S3 upload URL** with stricter limits than anything else in the app: max ~5MB per image, allow-list `image/jpeg`, `image/png`, `image/webp` only — reject everything else, including SVG (it can carry executable/script content).
- Upload target is a private **quarantine bucket** — never reachable via CloudFront, never public.
- **GuardDuty Malware Protection for S3** enabled on the quarantine bucket — scans every new object on upload; it can run standalone without enabling full GuardDuty if you want to keep it cost-scoped. This is the AWS-native scan called for in [[wiki/CodeContext/Standards/security|Security]], no third-party AV service needed.
- On upload, an S3 event triggers a processing Lambda (**Pillow**, matching the Python backend — no need for a Node/Sharp side-service) that: verifies the real file type by actually opening/parsing the image rather than trusting the extension or declared `Content-Type`, strips EXIF metadata (a user's photo can otherwise leak GPS location), and generates the served size plus a thumbnail.
- Only after the malware scan passes and processing succeeds does the Lambda copy the output to the **public media bucket** — the only media bucket CloudFront serves. Anything that fails scan or validation is deleted, not silently kept for review.
- Rate-limit uploads per user the same way posts are rate-limited (see [[wiki/CodeContext/Standards/security|Security]]) — an open upload endpoint is a storage-cost and abuse vector independent of the malware question. Not built yet; recorded in [[wiki/CodeContext/Modules/0x00b-architecture-iam-gaps|0x00b]] "Known gaps".
- Media processing is a Template Method (see [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]]).

## Frontend
- **React + TypeScript**, built with **Vite** (faster dev/build than CRA, no reason to use anything heavier for this).
- Component/design layer: the `ui-design` skill (`omer-metin/skills-for-antigravity`) is committed at `.claude/skills/ui-design/`, installed as copied files, not through its `npx` installer. Look-and-feel decisions and plans live in `wiki/CodeContext/FrontendUI/` (start at its `index.md`); the human's decisions are ADRs 0010–0018 in `wiki/GeneralContext/Decisions/`.
- Serve the built static bundle from **S3 + CloudFront** (same distribution or a second one in front of the API — see Storage/CDN/DNS below).

## Storage, CDN, DNS
- **S3** for the built frontend and the two-bucket media pipeline (quarantine + public) described under Media uploads above.
- **CloudFront** in front of S3 and API Gateway — this is also the security edge (see [[wiki/CodeContext/Standards/security|Security]]). Never expose S3 or API Gateway directly to the internet.
- **Route 53** for DNS, **ACM** for TLS certificates (free, auto-renewing, required for CloudFront anyway).

## Auth
- **Cognito** — free tier covers 50k+ MAU, handles password storage, MFA, token issuance. Do not roll your own auth.

## Async / decoupling
- **EventBridge** `PostEventBus` for domain events — the literal implementation of the Observer pattern in [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]]. Today `posts/` publishes `PostCreated` and `PostReported`, `users/` publishes `UserFollowed`, and the notifications consumer subscribes to `PostCreated` and `UserFollowed`.
- **SQS** (with a dead-letter queue on every consumer queue) for anything that must survive a downstream outage — notification fan-out.

## Messaging
- **SES** for transactional email, **SNS** for push/SMS. Both pay-per-message, no idle cost.

## Infrastructure as code
- **AWS CDK** in TypeScript ([[wiki/CodeContext/Standards/build-deployment-packages|Packages]] "Infra — CDK language choice"). Every resource defined in code, reviewed like any other PR, never created by hand in the console.

## CI/CD
- **GitHub Actions**, deploying via CDK. Assume an IAM role via **OIDC federation** — no long-lived AWS access keys stored in GitHub secrets, ever.

## Observability & cost control
- **CloudWatch** Logs/Metrics/Alarms — default log retention set explicitly (never "never expire") to control storage cost. Lambda and HTTP API access log groups keep one month (`RetentionDays.ONE_MONTH`).
- **AWS Budgets** with an SNS alarm at a hard dollar threshold — this is the tripwire against a runaway bill, set it up before anything else goes live. The live budget: [[wiki/CodeContext/Modules/0x00c-architecture-aws-account|0x00c]] "AWS Budgets".

## Explicitly rejected at this scale
- **NAT Gateway** — hourly cost regardless of traffic. Lambda needs VPC access here (to reach RDS). Gateway endpoints (S3, DynamoDB) are free and used. There are **no interface endpoints**: all other AWS API calls and internet egress go through the NAT instance below.
  - **Egress** ([[wiki/GeneralContext/Decisions/0019-egress-idle-cost-and-nat-ami-cadence|ADR 0019]]): in-VPC Lambdas must reach Cognito's JWKS and AWS APIs. A single small **NAT instance** (`t4g.nano`, ~$3/mo) provides that egress. It is *not* a NAT Gateway, which stays rejected. It gets no SSH/key pair (admin via SSM Session Manager only, per [[wiki/CodeContext/Standards/security|Security]]), a security group admitting only the Lambda SG, and its own least-privilege role.
- **Application Load Balancer** — hourly cost regardless of traffic. API Gateway replaces it for HTTP workloads.
- **ElastiCache** — hourly cost regardless of traffic. No cache is in use; revisit ElastiCache only if a real cache need outgrows DynamoDB.
- **Third-party hosting/PaaS (Vercel, Heroku, Render, etc.)** — explicitly out of scope per the human's requirement to run security yourself on AWS primitives.
