---
type: reference
---

# Design Principles

Apply these regardless of language or stack. See [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] for infrastructure, [[wiki/CodeContext/Standards/security|Security]] for security requirements, [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]] for structural pattern usage.

## Structural rules
- **Single Responsibility** — one reason to change per module/class. If you describe it with "and", split it.
- **Open/Closed** — use an extension point for a genuinely distinct behaviour. Correct defects in the owning implementation; do not add a subclass, wrapper or alternate path merely to avoid fixing it.
- **Liskov Substitution** — a subtype must be usable anywhere its base type is used, with no surprise behavior.
- **Interface Segregation** — many narrow interfaces over one broad one. No client depends on methods it doesn't use.
- **Dependency Inversion** — depend on abstractions. High-level modules never import low-level implementation details directly; inject them.
- **Composition over inheritance** — default to composing small objects. Inherit only for genuine is-a relationships with stable contracts.
- **Single source of truth** — every piece of state or config has exactly one owner. Everything else references it, never copies it.

## Simplicity rules
- **DRY** — one authoritative representation of any piece of knowledge. Duplication of logic is a defect, not a style choice.
- **KISS** — the simplest design that meets the actual requirement wins. Cleverness is a liability.
- **YAGNI** — do not build for hypothetical future requirements. No speculative abstraction, no unused config flags.
- Three similar lines beat a premature abstraction. Extract only after the third real repetition.

## Code quality and technical debt

Use the [zero-tech-debt skill](../../../.agents/skills/zero-tech-debt/SKILL.md)
when refactoring or removing workaround paths. It supports these rules; it
does not authorize changes outside the task or override approved decisions.

- Trace a defect to the implementation that owns the broken invariant. Fix
  that owner and its affected callers together. A new class must represent
  a real responsibility or supported variation, with a concrete caller.
- Keep one authoritative implementation of each rule. Remove superseded
  branches, flags and adapters in the affected scope after checking callers,
  dependency injection, external consumers and persisted data. An empty text
  search alone does not establish that a public contract is unused.
- Do not turn unexpected failures into successful empty/default results.
  Recovery must implement a supported requirement, preserve security and make
  failures diagnosable. Loading states, bounded retries and test doubles are
  legitimate when their contracts require them.
- Comments explain constraints and invariants. A comment saying a workaround
  is necessary is a claim to verify, not authority to perpetuate it. Remove
  obsolete instructions with the obsolete code. For a retained exception,
  identify the concrete constraint, supporting evidence and removal condition;
  link an owner-approved architecture decision where one exists. Preserve
  those decisions unless the owner changes them.
- Tests assert independently derived behaviour through the real affected
  path, including relevant failure cases. Do not weaken assertions, add
  production-only test hooks or suppress checks to make a patch pass.
- Compactness means fewer redundant concepts and execution paths. Preserve
  readable names, module boundaries, required validation and useful comments;
  line-count reductions alone do not demonstrate improvement.

For a cleanup, report the removed paths, evidence that affected contracts
still hold, and any retained exception. These are review requirements, not
an automated proof that the repository has no technical debt.

## Correctness rules
- **Fail fast** — invalid state throws immediately at the boundary, not silently downstream.
- **Validate at boundaries only** — trust internal code and typed contracts; validate user input, external API responses, and file/DB reads.
- **Immutability by default** — mutate only when there's a measured reason (performance, required state machine).
- **Idempotency** — any operation that can be retried (network call, queue consumer, deploy step) must be safe to run twice.
- **Explicit over implicit** — no hidden global state, no magic side effects in getters, no implicit type coercion relied upon.

## Delivery rules
- **12-factor app** — config in environment/parameter store, not in code; no baked-in environment assumptions; logs to stdout/stderr, not files.
- **Stateless services** — application processes hold no session state; state lives in the database, cache, or object store.
- **Testing pyramid** — many fast unit tests, fewer integration tests, minimal end-to-end tests. No implementation without a failing test first.
- **Observability is a requirement, not a nice-to-have** — every service emits structured logs, metrics, and traces sufficient to debug production without redeploying.

## Security baseline (every project, every stack)
- Least privilege on every credential, role, and API key — default deny, grant only what's used.
- No secrets in source, commit history, or client-side code. Secrets live in a secrets manager/parameter store.
- Encrypt in transit (TLS everywhere) and at rest (managed keys minimum, customer-managed keys for sensitive data).
- All authentication and authorization checks happen server-side. Client-side checks are UX only, never a security boundary.
- Dependencies are scanned for known CVEs in CI; unpatched criticals block merge.
- See [[wiki/CodeContext/Standards/security|Security]] for the AWS-specific implementation of this baseline.
