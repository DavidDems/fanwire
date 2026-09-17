# Design principles & security baseline

Full detail: `wiki/CodeContext/Standards/design-principles.md`, `wiki/CodeContext/Standards/security.md`.

## MUST NOT
- Build for a hypothetical future requirement not in `wiki/GeneralContext/Architecture/business-rules.md` — no speculative abstraction, no unused config flag (YAGNI).
- Duplicate a piece of logic or knowledge that already has one authoritative representation elsewhere (DRY) — extend or call it, don't copy it.
- Choose cleverness over the simplest design that meets the actual stated requirement (KISS).
- Let invalid state pass silently downstream instead of throwing at the boundary (fail fast).
- Validate/re-validate internal, already-typed data as if it were untrusted input — validate only at real boundaries (user input, external API responses, file/DB reads).
- Put a secret, API key, or credential in source, commit history, or client-side code — secrets live only in Secrets Manager/Parameter Store.
- Implement client-side authorization as if it were a security boundary — every authZ/authN check happens server-side.
- Merge a diff with a known unpatched critical CVE in a dependency.
- Write a log statement containing an unhashed secret or unhashed PII.
